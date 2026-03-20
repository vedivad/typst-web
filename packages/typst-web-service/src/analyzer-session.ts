import type { LspDiagnostic } from "./analyzer-types.js";
import type { TypstAnalyzer } from "./analyzer.js";

export interface AnalyzerSessionOptions {
  analyzer: Pick<TypstAnalyzer, "ready" | "didOpen" | "didChange" | "didChangeFast">;
  /** Project root used to build stable in-memory analyzer URIs. Default: "/project". */
  rootPath?: string;
  /** Entry file path within the project. Synced last to ensure dependencies load first. Default: "/main.typ". */
  entryPath?: string;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeRoot(rootPath: string): string {
  const root = normalizePath(rootPath);
  return root === "/" ? "" : root.replace(/\/+$/, "");
}

const RETRY_DELAY_MS = 25;

/**
 * Synchronizes an in-memory Typst project with a TypstAnalyzer and returns
 * diagnostics for the active file. Handles multi-file ordering and avoids
 * cross-file race conditions in tabbed editors.
 *
 *   const session = new AnalyzerSession({ analyzer });
 *   const diags = await session.syncAndDiagnose("/main.typ", source, files);
 */
export class AnalyzerSession {
  readonly ready: Promise<void>;

  private readonly analyzer: Pick<TypstAnalyzer, "ready" | "didOpen" | "didChange" | "didChangeFast">;
  private readonly rootPath: string;
  private readonly entryPath: string;
  private readonly syncedFiles = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AnalyzerSessionOptions) {
    this.analyzer = options.analyzer;
    this.rootPath = normalizeRoot(options.rootPath ?? "/project");
    this.entryPath = normalizePath(options.entryPath ?? "/main.typ");
    this.ready = this.analyzer.ready;
  }

  async syncAndDiagnose(
    path: string,
    content: string,
    files: Record<string, string>,
  ): Promise<LspDiagnostic[]> {
    const normalizedPath = normalizePath(path);
    const mergedFiles = { ...files, [normalizedPath]: content };

    const changedPaths = await this.enqueue(async () => {
      await this.ready;
      return this.syncFiles(mergedFiles, normalizedPath);
    });

    return this.enqueue(async () => {
      const uri = this.toUri(normalizedPath);
      const current = mergedFiles[normalizedPath];
      const first = await this.analyzer.didChange(uri, current);
      if (first.length > 0) return first;

      let changedOtherFiles = false;
      for (const changedPath of changedPaths) {
        if (changedPath !== normalizedPath) {
          changedOtherFiles = true;
          break;
        }
      }
      if (!changedOtherFiles) return first;

      // tinymist notifications can lag behind a didChange round-trip after cross-file updates.
      await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      return this.analyzer.didChange(uri, current);
    });
  }

  private toUri(path: string): string {
    return `untitled:${this.rootPath}${normalizePath(path)}`;
  }

  private orderedPaths(files: Record<string, string>): string[] {
    return Object.keys(files)
      .map((path) => normalizePath(path))
      .sort((a, b) => {
        if (a === this.entryPath) return 1;
        if (b === this.entryPath) return -1;
        return a.localeCompare(b);
      });
  }

  private async syncFiles(files: Record<string, string>, activePath: string): Promise<Set<string>> {
    const changedPaths = new Set<string>();

    for (const path of this.orderedPaths(files)) {
      if (path === activePath) continue;

      const next = files[path];
      const prev = this.syncedFiles.get(path);

      if (prev == null) {
        await this.analyzer.didOpen(this.toUri(path), next);
        this.syncedFiles.set(path, next);
        changedPaths.add(path);
        continue;
      }

      if (prev !== next) {
        await this.analyzer.didChangeFast(this.toUri(path), next);
        this.syncedFiles.set(path, next);
        changedPaths.add(path);
      }
    }

    for (const path of Array.from(this.syncedFiles.keys())) {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        this.syncedFiles.delete(path);
      }
    }

    return changedPaths;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
