import * as Comlink from "comlink";
import type { Remote } from "comlink";
import { CompileScheduler } from "./compile-scheduler.js";
import { byteOffsetsToCm, cmOffsetsToByte, cmOffsetToByte } from "./coords.js";
import { normalizePath, type Path } from "./identifiers.js";
import { createPackageLoader, type PackageLoader } from "./packages.js";
import type {
  ClickJump,
  CompileResult,
  CompletionResponse,
  HlSpan,
  Hover,
  RenderedSvgPage,
} from "./types.js";
import type { TypstenWorkerApi } from "./typsten-worker.js";

export interface TypstProjectCreateOptions {
  /** Default entry file path. Default: "/main.typ". */
  entry?: string;
  /** Auto-compile scheduling after VFS mutations. */
  autoCompile?: AutoCompileOptions;
}

export interface AutoCompileOptions {
  /** Idle time (ms) after the last mutation before a compile fires. Default: 0. */
  debounceMs?: number;
  /** Max time (ms) the debounce may defer during sustained edits. Default: 0. */
  maxWaitMs?: number;
}

export type CompileListener = (result: CompileResult) => void;

const DEFAULT_ENTRY = "/main.typ";
const encoder = new TextEncoder();

function errorAsCompileResult(err: unknown): CompileResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    pages: [],
    diagnostics: [
      { severity: "error", message, hints: [], location: undefined },
    ],
  };
}

function toBytes(content: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
  }
  return new Uint8Array(content);
}

/**
 * Multi-file Typst project backed by a single typsten wasm worker. Owns the
 * VFS; editors push `setText` edits as the user types; the project mirrors them
 * to the worker, fetches `@preview` packages on demand, and compiles or renders
 * against the current state.
 *
 *   const project = await TypstProject.create();
 *   await project.setMany({ "/main.typ": "..." });
 *   const { pages } = await project.compile();
 *   const svg = await project.renderPage(0);
 */
export class TypstProject {
  /**
   * Tracked project files: the text content for a text file, or `null` for a
   * binary one. Drives dedup, `getText`, `files`, and `clear`. (Cached `@preview`
   * package files live only in the worker VFS, never here.)
   */
  private readonly tracked = new Map<Path, string | null>();
  private readonly compileListeners = new Set<CompileListener>();
  private readonly scheduler: CompileScheduler;
  private readonly packageLoader: PackageLoader;
  private compileVersion = 0;
  private _lastResult: CompileResult | undefined;
  private _entry: Path;
  private destroyed = false;

  private constructor(
    private readonly engine: Remote<TypstenWorkerApi>,
    private readonly worker: Worker,
    options: TypstProjectCreateOptions,
  ) {
    this._entry = normalizePath(options.entry ?? DEFAULT_ENTRY);
    this.scheduler = new CompileScheduler({
      debounceMs: options.autoCompile?.debounceMs,
      maxWaitMs: options.autoCompile?.maxWaitMs,
    });
    this.packageLoader = createPackageLoader((path, bytes) =>
      this.engine.setFile(path, bytes),
    );
  }

  /** Create a project: spin up the worker, init the wasm, set the entry. */
  static async create(
    options: TypstProjectCreateOptions = {},
  ): Promise<TypstProject> {
    const worker = new Worker(new URL("./typsten-worker.js", import.meta.url), {
      type: "module",
    });
    const engine = Comlink.wrap<TypstenWorkerApi>(worker);

    const wasmUrl = new URL("./typsten_bg.wasm", import.meta.url).href;
    await engine.init(wasmUrl);

    const project = new TypstProject(engine, worker, options);
    await engine.setEntry(project._entry);

    return project;
  }

  private scheduleCompile(): void {
    if (this.destroyed) return;
    this.scheduler.schedule(() => {
      this.compile().catch((err) => console.error("[typst]", err));
    });
  }

  /**
   * Mirror text into the VFS without scheduling a compile. Returns the in-flight
   * write to await, or `null` if the content is unchanged (deduped to a no-op).
   */
  private writeText(p: Path, content: string): Promise<unknown> | null {
    if (this.tracked.get(p) === content) return null;
    this.tracked.set(p, content);
    return this.engine.setFile(p, encoder.encode(content));
  }

  /** Mirror binary bytes into the VFS (always writes; binaries are not deduped). */
  private writeBinary(p: Path, bytes: Uint8Array): Promise<unknown> {
    this.tracked.set(p, null);
    return this.engine.setFile(p, bytes);
  }

  get entry(): Path {
    return this._entry;
  }

  set entry(path: Path) {
    const next = normalizePath(path);
    if (next === this._entry) return;
    this._entry = next;
    void this.engine.setEntry(next);
    this.scheduleCompile();
  }

  /** Most recent compile result, or `undefined` before the first compile. */
  get lastResult(): CompileResult | undefined {
    return this._lastResult;
  }

  /** Tracked text file paths, in insertion order (fresh array). */
  get files(): Path[] {
    return [...this.tracked]
      .filter(([, content]) => content !== null)
      .map(([path]) => path);
  }

  /** Current text for a tracked file, or `undefined` (binary or absent). */
  getText(path: Path): string | undefined {
    return this.tracked.get(normalizePath(path)) ?? undefined;
  }

  /** Add or overwrite a text file. No-op if unchanged. */
  async setText(path: Path, content: string): Promise<void> {
    const write = this.writeText(normalizePath(path), content);
    if (write) {
      await write;
      this.scheduleCompile();
    }
  }

  /** Add or overwrite a binary file (retires any text tracking for the path). */
  async setBinary(
    path: Path,
    content: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    await this.writeBinary(normalizePath(path), toBytes(content));
    this.scheduleCompile();
  }

  /** Batch set files. Strings dedup against tracked content; binaries always write. */
  async setMany(files: Record<Path, string | Uint8Array>): Promise<void> {
    const writes: Promise<unknown>[] = [];
    for (const [path, content] of Object.entries(files)) {
      const p = normalizePath(path);
      const write =
        typeof content === "string"
          ? this.writeText(p, content)
          : this.writeBinary(p, content);
      if (write) writes.push(write);
    }
    if (writes.length === 0) return;
    await Promise.all(writes);
    this.scheduleCompile();
  }

  /** Remove a file from the VFS. */
  async remove(path: Path): Promise<void> {
    const p = normalizePath(path);
    await this.engine.remove(p);
    this.tracked.delete(p);
    this.scheduleCompile();
  }

  /** Remove all tracked project files (cached `@preview` packages are kept). */
  async clear(): Promise<void> {
    await Promise.all(
      [...this.tracked.keys()].map((p) => this.engine.remove(p)),
    );
    this.tracked.clear();
    this.scheduleCompile();
  }

  /**
   * Register a font (TTF/OTF, or TTC collection bytes) so compilation can use
   * it, then recompile. The engine bundles default body, math, and monospace
   * fonts; use this to add families it does not ship (e.g. CJK or a custom
   * font). Fonts persist for the project's lifetime.
   *
   * Returns the canonical family name of each added face, the name Typst
   * groups and matches by (width/weight/style folded into the variant, so e.g.
   * "Roboto Condensed" reports as "Roboto"). Use it to label the font the way
   * `#set text(font: ...)` expects, instead of parsing the name table yourself.
   */
  async addFont(bytes: Uint8Array): Promise<string[]> {
    const families = await this.engine.addFont(bytes);
    this.scheduleCompile();
    return families;
  }

  /**
   * Drop every font added via `addFont`, resetting to the embedded defaults,
   * then recompile. The engine has no per-font removal, so to remove a font,
   * call this and re-`addFont` the ones to keep.
   */
  async clearFonts(): Promise<void> {
    await this.engine.clearFonts();
    this.scheduleCompile();
  }

  /**
   * Subscribe to compile results. Late subscribers get `lastResult` synchronously.
   * Returns an unsubscribe function.
   */
  onCompile(listener: CompileListener): () => void {
    this.compileListeners.add(listener);
    if (this._lastResult !== undefined) {
      try {
        listener(this._lastResult);
      } catch (err) {
        console.error("[typst] compile listener threw:", err);
      }
    }
    return () => {
      this.compileListeners.delete(listener);
    };
  }

  /**
   * Compile the current VFS state. Fetches any referenced `@preview` packages
   * first. Errors become a synthetic diagnostic. Listeners fire only for the
   * most recent compile (stale results are dropped).
   */
  async compile(): Promise<CompileResult> {
    this.scheduler.cancel();
    const version = ++this.compileVersion;
    let result: CompileResult;
    try {
      await this.packageLoader.ensure(
        [...this.tracked.values()].filter((v): v is string => v !== null),
      );
      result = await this.engine.compile();
    } catch (err) {
      result = errorAsCompileResult(err);
    }
    if (version === this.compileVersion) {
      this._lastResult = result;
      for (const listener of this.compileListeners) {
        try {
          listener(result);
        } catch (err) {
          console.error("[typst] compile listener threw:", err);
        }
      }
    }
    return result;
  }

  /** Render a single page of the last compile to SVG, or `undefined`. */
  renderPage(index: number): Promise<string | undefined> {
    return this.engine.renderPage(index);
  }

  /**
   * Render pages `[start, end)` as `RenderedSvgPage`s (index + dims + svg),
   * zipping the SVG strings with the page metadata from the last compile.
   */
  async renderedPages(start: number, end: number): Promise<RenderedSvgPage[]> {
    const pages = this._lastResult?.pages ?? [];
    const svgs = await this.engine.renderPages(start, end);
    return svgs.map((svg, i) => {
      const index = start + i;
      const dims = pages[index];
      return {
        index,
        width: dims?.width ?? 0,
        height: dims?.height ?? 0,
        svg,
      };
    });
  }

  /**
   * Export the last compile as a PDF, or `undefined` if nothing has compiled
   * yet. The bytes are a fresh `Uint8Array` (copied across the worker boundary).
   */
  exportPdf(): Promise<Uint8Array | undefined> {
    return this.engine.exportPdf();
  }

  /**
   * Resolve a click at `(x, y)` points on page `index` of the last compile into
   * where it should take the user: a source location (file/line/column) for a
   * click on text, an internal link target (page + point in points) to scroll to,
   * or a URL. `undefined` if nothing compiled, the page is out of range, or the
   * click hit nothing actionable. Powers click-to-source and clickable links,
   * which the SVG can't express on its own.
   */
  clickJump(
    index: number,
    x: number,
    y: number,
  ): Promise<ClickJump | undefined> {
    return this.engine.clickJump(index, x, y);
  }

  /** Completions at a CodeMirror `offset` in `path`, using `source` as the live buffer. */
  async completion(
    path: Path,
    source: string,
    offset: number,
    explicit = false,
  ): Promise<CompletionResponse | undefined> {
    const p = normalizePath(path);
    await this.writeText(p, source);
    return this.engine.complete(p, cmOffsetToByte(source, offset), explicit);
  }

  /** Hover tooltip at a CodeMirror `offset` in `path`, using `source` as the live buffer. */
  async hover(
    path: Path,
    source: string,
    offset: number,
  ): Promise<Hover | undefined> {
    const p = normalizePath(path);
    await this.writeText(p, source);
    return this.engine.hover(p, cmOffsetToByte(source, offset));
  }

  /** Format `source` (the live buffer for `path`); returns the formatted text or `undefined`. */
  async format(path: Path, source: string): Promise<string | undefined> {
    const p = normalizePath(path);
    await this.writeText(p, source);
    return this.engine.format(p);
  }

  /**
   * Syntax-highlight `source` over the CodeMirror window `[from, to)` (UTF-16
   * offsets; defaults to the whole string). Returns spans whose `from`/`to` are
   * CodeMirror offsets, ready to drive decorations. Stateless: the worker parses
   * `source` directly via typst-syntax, so this neither reads nor mutates the
   * VFS and works for any text (the live buffer, a hover code snippet).
   */
  async highlight(
    source: string,
    from = 0,
    to = source.length,
  ): Promise<HlSpan[]> {
    const [byteFrom, byteTo] = cmOffsetsToByte(source, [from, to]);
    const spans = await this.engine.highlight(source, byteFrom, byteTo);
    if (spans.length === 0) return spans;
    // The worker speaks UTF-8 bytes; map every span boundary back to UTF-16
    // (CodeMirror) offsets in one pass over the source. Boundaries are not
    // monotonic (nested spans wrap inner ones), so byteOffsetsToCm sorts them.
    const cm = byteOffsetsToCm(
      source,
      spans.flatMap((s) => [s.from, s.to]),
    );
    return spans.map((s, i) => ({
      from: cm[i * 2],
      to: cm[i * 2 + 1],
      tag: s.tag,
    }));
  }

  /**
   * Syntax-highlight `source` to nested `<span class="typ-*">` HTML for a static
   * context (e.g. a hover tooltip). Stateless, like `highlight`.
   */
  highlightHtml(source: string): Promise<string> {
    return this.engine.highlightHtml(source);
  }

  /** Tear down the worker and drop all state. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scheduler.cancel();
    this.compileListeners.clear();
    this.tracked.clear();
    this._lastResult = undefined;
    this.engine[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
