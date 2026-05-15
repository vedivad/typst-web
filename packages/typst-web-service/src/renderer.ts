import {
  createTypstRenderer,
  type TypstRenderer as InnerTypstRenderer,
} from "@myriaddreamin/typst.ts";

declare const __TYPST_TS_RENDERER_VERSION__: string;

const DEFAULT_RENDERER_WASM_URL = `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@${__TYPST_TS_RENDERER_VERSION__}/pkg/typst_ts_renderer_bg.wasm`;

export interface TypstRendererOptions {
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
 * Converts Typst vector artifacts to SVG strings.
 *
 * Thin wrapper around `@myriaddreamin/typst.ts`'s renderer: we own the public
 * API surface and WASM-URL convention; typst.ts owns the WASM session,
 * sub-page rendering, and lifecycle. See `renderer.mts` in that package for
 * the inner mechanics.
 *
 *   const renderer = TypstRenderer.create();
 *   const svg = await renderer.renderSvg(vector);
 */
export class TypstRenderer {
  private readonly wasmUrl: string;
  private inner: Promise<InnerTypstRenderer> | null = null;

  private constructor(options: TypstRendererOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_RENDERER_WASM_URL;
    // Kick off WASM fetch eagerly so it's warm by first render.
    void this.getInner();
  }

  static create(options: TypstRendererOptions = {}): TypstRenderer {
    return new TypstRenderer(options);
  }

  private getInner(): Promise<InnerTypstRenderer> {
    if (!this.inner) {
      this.inner = this.#initInner().catch((err) => {
        this.inner = null;
        throw err;
      });
    }
    return this.inner;
  }

  async #initInner(): Promise<InnerTypstRenderer> {
    const inner = createTypstRenderer();
    await inner.init({ getModule: () => this.wasmUrl });
    return inner;
  }

  /**
   * Drop the reference to the inner renderer. The upstream wrapper doesn't
   * expose an explicit free(); the WASM module is reclaimed when the page
   * unloads. Consumers may still call this to release the JS-side handle.
   */
  destroy(): void {
    this.inner = null;
  }

  /** Render a Typst vector artifact to a single merged SVG string. */
  async renderSvg(vector: Uint8Array): Promise<string> {
    const inner = await this.getInner();
    return inner.renderSvg({ format: "vector", artifactContent: vector });
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
