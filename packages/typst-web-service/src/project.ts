import * as Comlink from "comlink";
import type { Remote } from "comlink";
import { CompileScheduler } from "./compile-scheduler.js";
import { cmOffsetToByte } from "./coords.js";
import { normalizePath, type Path } from "./identifiers.js";
import { createPackageLoader, type PackageLoader } from "./packages.js";
import { createWorker } from "./rpc.js";
import type { CompileResult, CompletionResponse, Hover, RenderedSvgPage } from "./types.js";
import type { TypstenWorkerApi } from "./typsten-worker.js";

export interface TypstProjectCreateOptions {
  /**
   * URL of the typsten `*_bg.wasm`. Optional: defaults to the wasm shipped next
   * to this package's `dist/`, self-resolved via `import.meta.url`, so consumers
   * normally need not provide it. Pass an explicit URL (e.g. a Vite `?url`
   * import) only to override where the engine is loaded from.
   */
  wasmUrl?: string;
  /** Default entry file path. Default: "/main.typ". */
  entry?: string;
  /** Auto-compile scheduling after VFS mutations. */
  autoCompile?: AutoCompileOptions;
  /**
   * Fetch `@preview` packages over HTTP on demand. Default: `true`. Set `false`
   * to skip the network entirely (imports then resolve only from pushed files).
   */
  packages?: boolean;
  /** Provide your own Worker (e.g. for a bundler that needs an explicit entry). */
  worker?: Worker;
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
    diagnostics: [{ severity: "error", message, hints: [], location: undefined }],
  };
}

function toBytes(content: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  return new Uint8Array(content);
}

/**
 * Multi-file Typst project backed by a single typsten wasm worker. Owns the
 * VFS; editors push `setText` edits as the user types; the project mirrors them
 * to the worker, fetches `@preview` packages on demand, and compiles or renders
 * against the current state.
 *
 *   const project = await TypstProject.create({ wasmUrl });
 *   await project.setMany({ "/main.typ": "..." });
 *   const { pages } = await project.compile();
 *   const svg = await project.renderPage(0);
 */
export class TypstProject {
  /** All tracked project file paths (text + binary). Drives `clear`. */
  private readonly trackedPaths = new Set<Path>();
  /** Tracked text content, for dedup and `getText`. */
  private readonly contentByPath = new Map<Path, string>();
  private readonly compileListeners = new Set<CompileListener>();
  private readonly scheduler: CompileScheduler;
  private readonly packageLoader?: PackageLoader;
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
    if (options.packages !== false) {
      this.packageLoader = createPackageLoader((path, bytes) =>
        this.engine.setFile(path, bytes),
      );
    }
  }

  /** Create a project: spin up the worker, init the wasm, set the entry. */
  static async create(options: TypstProjectCreateOptions): Promise<TypstProject> {
    const worker = options.worker ?? createWorker();
    const engine = Comlink.wrap<TypstenWorkerApi>(worker);
    // Resolve to an absolute URL on the main thread: the worker is a blob: URL,
    // so a relative path (e.g. Vite's `/@fs/...`) would not resolve there. With
    // no explicit URL, fall back to the wasm shipped next to dist/index.js,
    // resolved against this module's own URL.
    const wasmUrl = options.wasmUrl
      ? new URL(options.wasmUrl, globalThis.location?.href).href
      : new URL("./typsten_bg.wasm", import.meta.url).href;
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

  /** Write text into the VFS without scheduling a compile (dedup'd). */
  private async writeText(p: Path, content: string): Promise<boolean> {
    if (this.contentByPath.get(p) === content) return false;
    await this.engine.setFile(p, encoder.encode(content));
    this.contentByPath.set(p, content);
    this.trackedPaths.add(p);
    return true;
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
    return [...this.contentByPath.keys()];
  }

  /** Current text for a tracked file, or `undefined`. */
  getText(path: Path): string | undefined {
    return this.contentByPath.get(normalizePath(path));
  }

  /** Add or overwrite a text file. No-op if unchanged. */
  async setText(path: Path, content: string): Promise<void> {
    if (await this.writeText(normalizePath(path), content)) this.scheduleCompile();
  }

  /** Add or overwrite a binary file (retires any text tracking for the path). */
  async setBinary(path: Path, content: ArrayBuffer | ArrayBufferView): Promise<void> {
    const p = normalizePath(path);
    await this.engine.setFile(p, toBytes(content));
    this.contentByPath.delete(p);
    this.trackedPaths.add(p);
    this.scheduleCompile();
  }

  /** Add or overwrite a JSON data file. */
  async setJson(path: Path, value: unknown): Promise<void> {
    const p = normalizePath(path);
    await this.engine.setFile(p, encoder.encode(JSON.stringify(value)));
    this.contentByPath.delete(p);
    this.trackedPaths.add(p);
    this.scheduleCompile();
  }

  /** Batch set files. Strings dedup against tracked content; binaries always write. */
  async setMany(files: Record<Path, string | Uint8Array>): Promise<void> {
    let changed = false;
    const writes: Promise<unknown>[] = [];
    for (const [path, content] of Object.entries(files)) {
      const p = normalizePath(path);
      if (typeof content === "string") {
        if (this.contentByPath.get(p) === content) continue;
        writes.push(this.engine.setFile(p, encoder.encode(content)));
        this.contentByPath.set(p, content);
      } else {
        writes.push(this.engine.setFile(p, content));
        this.contentByPath.delete(p);
      }
      this.trackedPaths.add(p);
      changed = true;
    }
    if (!changed) return;
    await Promise.all(writes);
    this.scheduleCompile();
  }

  /** Remove a file from the VFS. */
  async remove(path: Path): Promise<void> {
    const p = normalizePath(path);
    await this.engine.remove(p);
    this.contentByPath.delete(p);
    this.trackedPaths.delete(p);
    this.scheduleCompile();
  }

  /** Remove all tracked project files (cached `@preview` packages are kept). */
  async clear(): Promise<void> {
    await Promise.all([...this.trackedPaths].map((p) => this.engine.remove(p)));
    this.contentByPath.clear();
    this.trackedPaths.clear();
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
      await this.packageLoader?.ensure(this.contentByPath.values());
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

  /** Render pages `[start, end)` of the last compile to SVG (end clamped). */
  renderPages(start: number, end: number): Promise<string[]> {
    return this.engine.renderPages(start, end);
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
  async hover(path: Path, source: string, offset: number): Promise<Hover | undefined> {
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

  /** Tear down the worker and drop all state. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scheduler.cancel();
    this.compileListeners.clear();
    this.contentByPath.clear();
    this.trackedPaths.clear();
    this._lastResult = undefined;
    this.engine[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}
