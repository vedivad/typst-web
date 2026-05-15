import * as Comlink from "comlink";
import {
  createTypstRenderer,
  type TypstRenderer as InnerTypstRenderer,
} from "@myriaddreamin/typst.ts";
// Static import so esbuild bundles the wasm-bindgen JS shim into the worker.
// Provided to typst.ts via `getWrapper` so it doesn't fall back to its
// `await import("@myriaddreamin/typst-ts-renderer")`.
import * as typstTsRenderer from "@myriaddreamin/typst-ts-renderer";

export class RendererWorker {
  #inner: InnerTypstRenderer | null = null;

  #ensureInner(): InnerTypstRenderer {
    if (!this.#inner) throw new Error("Renderer not initialized");
    return this.#inner;
  }

  async init(wasmUrl: string): Promise<void> {
    this.#inner = createTypstRenderer();
    await this.#inner.init({
      getModule: () => wasmUrl,
      getWrapper: () => Promise.resolve(typstTsRenderer),
    });
  }

  /**
   * Vector → merged SVG string. typst.ts's `renderSvg` produces the whole
   * document as one SVG with `<g class="typst-page">` children. The main-side
   * `TypstRenderer.renderSvgPages` splits it; doing the split here would
   * require DOMParser, which Web Workers don't have.
   */
  async renderSvg(vector: Uint8Array): Promise<string> {
    return this.#ensureInner().renderSvg({
      format: "vector",
      artifactContent: vector,
    });
  }

  destroy(): void {
    this.#inner = null;
  }
}

Comlink.expose(new RendererWorker());
