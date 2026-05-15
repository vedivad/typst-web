import * as Comlink from "comlink";
import {
  createTypstRenderer,
  type RenderSession,
  type TypstRenderer as InnerTypstRenderer,
} from "@myriaddreamin/typst.ts";
// Static import so esbuild bundles the wasm-bindgen JS shim into the worker.
// Provided to typst.ts via `getWrapper` so it doesn't fall back to its
// `await import("@myriaddreamin/typst-ts-renderer")`.
import * as typstTsRenderer from "@myriaddreamin/typst-ts-renderer";

export class RendererWorker {
  #inner: InnerTypstRenderer | null = null;
  #session: RenderSession | null = null;
  #closeSession: (() => void) | null = null;
  // Cache of `data:image/*;base64,...` → blob URL. Worker-local; blob URLs
  // are accessible from any thread on the same origin, so the main thread's
  // `<image>` elements can resolve them. Revoked on `destroy`.
  readonly #blobCache = new Map<string, string>();

  #ensureInner(): InnerTypstRenderer {
    if (!this.#inner) throw new Error("Renderer not initialized");
    return this.#inner;
  }

  #ensureSession(): RenderSession {
    if (!this.#session) throw new Error("Renderer not initialized");
    return this.#session;
  }

  async init(wasmUrl: string): Promise<void> {
    this.#inner = createTypstRenderer();
    await this.#inner.init({
      getModule: () => wasmUrl,
      getWrapper: () => Promise.resolve(typstTsRenderer),
    });
    // Hold one render session open for the worker's lifetime so decoded
    // image bitmaps + fonts stay warm in the WASM side across compiles.
    // Each `renderSvg` resets the artifact data; cached resources persist.
    const { session, close } = await openSession(this.#inner);
    this.#session = session;
    this.#closeSession = close;
  }

  /**
   * Vector → merged SVG string. typst.ts's `renderSvg` produces the whole
   * document as one SVG with `<g class="typst-page">` children. The main-side
   * `TypstRenderer.renderSvgPages` splits it; doing the split here would
   * require DOMParser, which Web Workers don't have.
   *
   * Embedded `<image href="data:image/*;base64,...">` URLs are rewritten to
   * cached blob URLs before the string crosses postMessage. That keeps the
   * returned SVG small (a multi-MB PNG becomes a ~40 char `blob:` URL), so
   * the structured-clone copy, the main-side DOMParser, and the browser's
   * per-page `innerHTML` parse all stay fast. The browser also caches
   * decoded image bitmaps by blob-URL identity, so repeat references skip
   * decoding entirely.
   */
  async renderSvg(vector: Uint8Array): Promise<string> {
    const session = this.#ensureSession();
    session.manipulateData({ action: "reset", data: vector });
    const svg = await this.#ensureInner().renderSvg({ renderSession: session });
    return this.#rewriteImageUrls(svg);
  }

  #rewriteImageUrls(svg: string): string {
    return svg.replaceAll(
      /(xlink:href|href)="(data:image\/[^;,]+;base64,[^"]+)"/g,
      (_match, attr: string, dataUrl: string) => {
        let blobUrl = this.#blobCache.get(dataUrl);
        if (!blobUrl) {
          blobUrl = URL.createObjectURL(dataUrlToBlob(dataUrl));
          this.#blobCache.set(dataUrl, blobUrl);
        }
        return `${attr}="${blobUrl}"`;
      },
    );
  }

  destroy(): void {
    for (const url of this.#blobCache.values()) URL.revokeObjectURL(url);
    this.#blobCache.clear();
    this.#closeSession?.();
    this.#closeSession = null;
    this.#session = null;
    this.#inner = null;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  const bytes = atob(b64);
  const u8 = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes.codePointAt(i)!;
  return new Blob([u8], { type: mime });
}

// typst.ts scope-guards sessions: `runWithSession(fn)` frees the session when
// `fn` resolves. We hold one open by parking it on a never-resolving promise
// that only resolves when `close()` is called.
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

Comlink.expose(new RendererWorker());
