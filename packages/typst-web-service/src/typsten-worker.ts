// The single Web Worker that hosts the typsten wasm. Replaces the former
// compiler / renderer / analyzer / formatter workers (typsten is one module).
// Exposed over Comlink; the `Project` wasm object never crosses the boundary -
// only plain data does.
import * as Comlink from "comlink";
import init, { Project } from "typsten";

class TypstenWorker {
  #project: Project | undefined;

  /** Initialize the wasm from `wasmUrl` and create the project handle. */
  async init(wasmUrl: string): Promise<void> {
    await init({ module_or_path: wasmUrl });
    this.#project = new Project();
  }

  #p(): Project {
    if (!this.#project) throw new Error("typsten worker: init() not called");
    return this.#project;
  }

  setFile(path: string, bytes: Uint8Array): void {
    this.#p().set_file(path, bytes);
  }

  setEntry(path: string): void {
    this.#p().set_entry(path);
  }

  addFont(bytes: Uint8Array): void {
    this.#p().add_font(bytes);
  }

  remove(path: string): void {
    this.#p().remove_file(path);
  }

  compile(): ReturnType<Project["compile"]> {
    return this.#p().compile();
  }

  renderPage(index: number): string | undefined {
    return this.#p().render_page(index);
  }

  renderPages(start: number, end: number): string[] {
    return this.#p().render_pages(start, end);
  }

  exportPdf(): Uint8Array | undefined {
    return this.#p().export_pdf();
  }

  complete(
    path: string,
    cursor: number,
    explicit: boolean,
  ): ReturnType<Project["complete"]> {
    return this.#p().complete(path, cursor, explicit);
  }

  hover(path: string, cursor: number): ReturnType<Project["hover"]> {
    return this.#p().hover(path, cursor);
  }

  format(path: string): string | undefined {
    return this.#p().format(path);
  }

  highlight(
    text: string,
    from: number,
    to: number,
  ): ReturnType<Project["highlight"]> {
    return this.#p().highlight(text, from, to);
  }

  highlightHtml(text: string): string {
    return this.#p().highlight_html(text);
  }
}

/** The worker's RPC surface, for `Comlink.wrap<TypstenWorkerApi>` on the main thread. */
export type TypstenWorkerApi = TypstenWorker;

Comlink.expose(new TypstenWorker());
