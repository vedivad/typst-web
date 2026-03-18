/** Minimal interface for the built TypstRenderer instance. */
export interface RendererInstance {
  create_session(): RendererSession;
  manipulate_data(
    session: RendererSession,
    action: string,
    data: Uint8Array,
  ): void;
  svg_data(session: RendererSession): string;
}

/** Minimal interface for a TypstRenderer session. */
export interface RendererSession {
  free(): void;
}

type RendererWasmModule = typeof import("@myriaddreamin/typst-ts-renderer");

const DEFAULT_RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.7.0-rc2/pkg/typst_ts_renderer_bg.wasm";

let rendererModulePromise: Promise<RendererWasmModule> | null = null;

function getRendererModule(): Promise<RendererWasmModule> {
  if (!rendererModulePromise) {
    rendererModulePromise = import("@myriaddreamin/typst-ts-renderer").catch(
      (err) => {
        rendererModulePromise = null;
        throw err;
      },
    );
  }
  return rendererModulePromise;
}

export interface TypstRendererOptions {
  /** URL to the typst-ts-renderer WASM binary. Defaults to jsDelivr CDN. */
  wasmUrl?: string;
}

/**
 * Converts Typst vector artifacts to SVG strings.
 *
 * The renderer WASM module is loaded lazily on first use.
 *
 *   const renderer = new TypstRenderer();
 *   const svg = await renderer.renderSvg(vector);
 */
export class TypstRenderer {
  private wasmUrl: string;
  private instance: Promise<RendererInstance> | null = null;

  constructor(options: TypstRendererOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_RENDERER_WASM_URL;
    // Eagerly start loading the WASM module so it's ready by first use.
    getRendererModule().catch(() => {});
  }

  private getInstance(): Promise<RendererInstance> {
    if (!this.instance) {
      this.instance = this.#init().catch((err) => {
        this.instance = null;
        throw err;
      });
    }
    return this.instance;
  }

  async #init(): Promise<RendererInstance> {
    const mod = await getRendererModule();
    await mod.default(this.wasmUrl);
    return new mod.TypstRendererBuilder().build();
  }

  /** Render a Typst vector artifact to an SVG string. */
  async renderSvg(vector: Uint8Array): Promise<string> {
    const renderer = await this.getInstance();
    const session = renderer.create_session();
    try {
      renderer.manipulate_data(session, "reset", vector);
      return renderer.svg_data(session);
    } finally {
      session.free();
    }
  }
}
