import {
  createTypstRenderer,
  type RenderSession,
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

  /**
   * Mount an incremental canvas renderer into `root`. Each `update(vector)`
   * call repaints the canvases in place. The win for image-heavy docs comes
   * from the persistent WASM session: decoded image bitmaps are cached in
   * the renderer, so subsequent paints skip the decode step. Canvas elements
   * are recreated each update (typst.ts manages the DOM inside `root`), but
   * canvas creation is cheap — the bottleneck the SVG path was solving was
   * `<image>` data-URL decode, not DOM construction.
   *
   * Call `reset()` when switching to an unrelated document (next `update`
   * starts fresh from the session). Call `dispose()` to free the session.
   *
   * Trade-off vs the SVG paths: output is rasterized — text in the rendered
   * canvas isn't selectable, and zoom past `pixelPerPt` needs a re-render to
   * stay crisp. typst.ts builds a `<canvas>` per page inside `root` and adds
   * a text-semantic layer alongside it for screen readers / a11y.
   */
  createIncrementalCanvasRenderer(
    root: HTMLElement,
    options: IncrementalCanvasOptions = {},
  ): IncrementalCanvasRenderer {
    return new IncrementalCanvasImpl(root, () => this.getInner(), options);
  }
}

export interface IncrementalCanvasOptions {
  pixelPerPt?: number;
  backgroundColor?: string;
}

export interface IncrementalCanvasRenderer {
  /**
   * Apply a new vector and repaint. First call seeds the session.
   *
   * Concurrent calls are serialized: while a repaint is in flight, the most
   * recent `update` becomes the next paint and intermediates are dropped.
   * All overlapping callers share one returned promise that resolves when
   * the chain catches up — your specific vector may have been superseded.
   */
  update(vector: Uint8Array): Promise<void>;
  /** Force the next `update` to re-seed (use when the doc identity changes). */
  reset(): void;
  /** Free the WASM session. */
  dispose(): void;
}

// Hold a typst.ts render session alive across multiple operations. typst.ts's
// API is scope-guarded (`runWithSession(fn)` frees the session when `fn`
// resolves); we occupy it with a never-resolving inner promise and let
// `close()` resolve it on dispose. The returned `session` is usable until
// `close()` is called.
async function openSession(
  inner: InnerTypstRenderer,
): Promise<{ session: RenderSession; close: () => void }> {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = resolve;
  });
  let session!: RenderSession;
  await new Promise<void>((ready, reject) => {
    void inner
      .runWithSession(async (s) => {
        session = s;
        ready();
        await closed;
      })
      .catch(reject);
  });
  return { session, close };
}

// typst.ts uses 3 as its internal default (PIXEL_PER_PT). Match on standard
// displays, bump on retina so canvases stay crisp at typical display sizes.
function defaultPixelPerPt(): number {
  const dpr =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { devicePixelRatio?: number }).devicePixelRatio === "number"
      ? (globalThis as { devicePixelRatio: number }).devicePixelRatio
      : 1;
  return Math.max(dpr * 1.5, 3);
}

interface OpenedSession {
  session: RenderSession;
  close: () => void;
  inner: InnerTypstRenderer;
}

class IncrementalCanvasImpl implements IncrementalCanvasRenderer {
  private opened: Promise<OpenedSession> | null = null;
  private inflight: Promise<void> | null = null;
  private pending: Uint8Array | null = null;
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly getInner: () => Promise<InnerTypstRenderer>,
    private readonly options: IncrementalCanvasOptions,
  ) {}

  private getOpened(): Promise<OpenedSession> {
    this.opened ??= this.getInner().then(async (inner) => ({
      ...(await openSession(inner)),
      inner,
    }));
    return this.opened;
  }

  update(vector: Uint8Array): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pending = vector;
    this.inflight ??= this.drain();
    return this.inflight;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending && !this.disposed) {
        const vector = this.pending;
        this.pending = null;
        await this.paint(vector);
      }
    } finally {
      this.inflight = null;
    }
  }

  private async paint(vector: Uint8Array): Promise<void> {
    const { session, inner } = await this.getOpened();
    if (this.disposed) return;
    session.manipulateData({ action: "reset", data: vector });
    // typst.ts wipes `innerHTML` before rebuilding and toggles
    // `visibility: hidden` for the duration. That hides the canvases but
    // doesn't preserve container *size* — multi-page docs collapse to
    // height: 0 during the wipe and the surrounding layout flashes. Locking
    // min-height to the pre-render value keeps it stable; cleared after.
    const previousHeight = this.root.offsetHeight;
    if (previousHeight > 0) {
      this.root.style.minHeight = `${previousHeight}px`;
    }
    try {
      await inner.renderToCanvas({
        container: this.root,
        renderSession: session,
        pixelPerPt: this.options.pixelPerPt ?? defaultPixelPerPt(),
        backgroundColor: this.options.backgroundColor ?? "#ffffff",
      });
    } finally {
      this.root.style.minHeight = "";
    }
  }

  reset(): void {
    // No-op
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Fire-and-forget: if the session is still opening, we'll close it once
    // it's ready; if it's already open, close immediately.
    void this.opened?.then(({ close }) => close());
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
    (el) =>
      el.tagName.toLowerCase() === "g" && el.classList.contains("typst-page"),
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
