import * as Comlink from "comlink";
import { createRendererWorker } from "./rpc.js";
import type { RendererWorker } from "./renderer-worker.js";

declare const __TYPST_TS_RENDERER_VERSION__: string;

const DEFAULT_RENDERER_WASM_URL = `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@${__TYPST_TS_RENDERER_VERSION__}/pkg/typst_ts_renderer_bg.wasm`;

export interface TypstRendererOptions {
  /**
   * Explicit Worker instance. When omitted, an inlined blob worker is created
   * automatically. Use this for Vite apps to get proper source maps:
   *   `TypstRenderer.create({ worker: new Worker(new URL('typst-web-service/renderer-worker', import.meta.url)) })`
   */
  worker?: Worker;
  /** URL to the typst-ts-renderer WASM binary. Defaults to jsDelivr CDN. */
  wasmUrl?: string;
}

export interface RenderedSvgPage {
  /** Zero-based page index within the document. */
  index: number;
  /** Page width in typographic points. */
  width: number;
  /** Page height in typographic points. */
  height: number;
  /** Standalone SVG string for just this page. */
  svg: string;
}

/**
 * Converts Typst vector artifacts to SVG strings, off the main thread.
 *
 * Wraps `@myriaddreamin/typst.ts`'s renderer hosted in a Web Worker — the
 * WASM init, vector → SVG conversion, and base64 image-embedding all happen
 * off-thread. Returned SVG strings cross via Comlink; page splitting runs on
 * the main thread (Workers don't have `DOMParser`).
 *
 *   const renderer = TypstRenderer.create();
 *   const svg = await renderer.renderSvg(vector);
 */
export class TypstRenderer {
  readonly #proxy: Comlink.Remote<RendererWorker>;
  readonly #worker: Worker;
  readonly #wasmUrl: string;
  #initPromise: Promise<void> | null = null;

  private constructor(worker: Worker, proxy: Comlink.Remote<RendererWorker>, wasmUrl: string) {
    this.#worker = worker;
    this.#proxy = proxy;
    this.#wasmUrl = wasmUrl;
    // Kick off WASM fetch eagerly so it's warm by first render.
    void this.#ensureInit();
  }

  static create(options: TypstRendererOptions = {}): TypstRenderer {
    const worker = options.worker ?? createRendererWorker();
    const proxy = Comlink.wrap<RendererWorker>(worker);
    return new TypstRenderer(worker, proxy, options.wasmUrl ?? DEFAULT_RENDERER_WASM_URL);
  }

  #ensureInit(): Promise<void> {
    if (!this.#initPromise) {
      this.#initPromise = this.#proxy.init(this.#wasmUrl).catch((err: unknown) => {
        this.#initPromise = null;
        throw err;
      });
    }
    return this.#initPromise;
  }

  /** Terminate the worker. The instance is unusable afterwards. */
  destroy(): void {
    this.#proxy[Comlink.releaseProxy]();
    this.#worker.terminate();
  }

  /** Render a Typst vector artifact to a single merged SVG string. */
  async renderSvg(vector: Uint8Array): Promise<string> {
    await this.#ensureInit();
    return this.#proxy.renderSvg(vector);
  }

  /**
   * Render a Typst vector artifact into one self-contained SVG string per
   * physical page. The merged SVG is split by `<g class="typst-page">`
   * children; each group's `data-page-width` / `data-page-height` give the
   * page-local viewBox. Shared `<defs>` / `<style>` are duplicated into each
   * page so the output SVGs render independently. Returns an empty array if
   * the document has no page groups.
   */
  async renderSvgPages(vector: Uint8Array): Promise<RenderedSvgPage[]> {
    return splitMergedSvgPages(await this.renderSvg(vector));
  }
}

// Parsing must use "text/html", not "image/svg+xml": Typst's merged SVG
// output has repeatedly failed XML-strict parsing. HTML mode tolerates it
// and still produces real SVGSVGElement nodes for inline SVG.
function splitMergedSvgPages(svg: string): RenderedSvgPage[] {
  const doc = new DOMParser().parseFromString(svg, "text/html");
  const root = doc.querySelector("svg");
  if (!root) return [];

  const children = Array.from(root.children);
  const pageGroups = children.filter(
    (el) => el.tagName.toLowerCase() === "g" && el.classList.contains("typst-page"),
  );
  if (pageGroups.length === 0) return [];

  const sharedHtml = children
    .filter((el) => !el.classList.contains("typst-page"))
    .map((el) => el.outerHTML)
    .join("");

  const namespaceAttrs = Array.from(root.attributes)
    .filter((attr) => attr.name === "xmlns" || attr.name.startsWith("xmlns:"))
    .map((attr) => `${attr.name}="${attr.value}"`)
    .join(" ");

  return pageGroups.flatMap((group, index) => {
    const width = Number(group.getAttribute("data-page-width")) || 0;
    const height = Number(group.getAttribute("data-page-height")) || 0;
    if (width <= 0 || height <= 0) return [];

    const clone = group.cloneNode(true) as Element;
    clone.removeAttribute("transform");

    return [
      {
        index,
        width,
        height,
        svg:
          `<svg ${namespaceAttrs} viewBox="0 0 ${width} ${height}" ` +
          `width="${width}" height="${height}">` +
          `${sharedHtml}${clone.outerHTML}</svg>`,
      },
    ];
  });
}
