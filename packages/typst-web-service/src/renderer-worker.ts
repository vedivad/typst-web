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
   */
  async renderSvg(vector: Uint8Array): Promise<string> {
    const session = this.#ensureSession();
    session.manipulateData({ action: "reset", data: vector });
    return this.#ensureInner().renderSvg({ renderSession: session });
  }

  destroy(): void {
    this.#closeSession?.();
    this.#closeSession = null;
    this.#session = null;
    this.#inner = null;
  }
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
