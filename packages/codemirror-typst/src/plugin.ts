import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import {
  AnalyzerSession,
  type CompileResult,
  type TypstAnalyzer,
  type TypstCompiler,
} from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";

export interface PluginOptions {
  compiler: TypstCompiler;
  /** tinymist analyzer for richer LSP diagnostics. When set, diagnostics come from here instead of the compiler. */
  analyzer?: TypstAnalyzer;
  /** Optional root path for auto-created analyzer sessions. Default: "/project". */
  projectRootPath?: string;
  /** Optional entry path for auto-created analyzer sessions. Default: "/main.typ". */
  projectEntryPath?: string;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The current editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Called after each successful compile with the full result. */
  onCompile?: (result: CompileResult) => void;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstLinterPlugin {
  private static sessionCache = new WeakMap<TypstAnalyzer, AnalyzerSession>();

  private controller: AbortController | null = null;
  private path: string;
  private analyzerGeneration = 0;

  constructor(private options: PluginOptions) {
    this.path = options.filePath ?? "/main.typ";
  }

  private getSession(): AnalyzerSession | undefined {
    const analyzer = this.options.analyzer;
    if (!analyzer) return undefined;

    const cached = TypstLinterPlugin.sessionCache.get(analyzer);
    if (cached) return cached;

    const session = new AnalyzerSession({
      analyzer,
      rootPath: this.options.projectRootPath ?? "/project",
      entryPath: this.options.projectEntryPath ?? "/main.typ",
    });
    TypstLinterPlugin.sessionCache.set(analyzer, session);
    return session;
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const source = view.state.doc.toString();

    const files = { ...this.options.getFiles?.(), [this.path]: source };

    let diagnostics: Diagnostic[];

    try {
      const result = await this.options.compiler.compile(files);

      if (signal.aborted) return [];

      this.options.onCompile?.(result);

      diagnostics = result.diagnostics
        .filter((d) => d.path === this.path)
        .map((d) => toCMDiagnostic(view.state, d));

      // Kick off tinymist in the background — don't block the lint return.
      const session = this.getSession();
      if (session) {
        const generation = ++this.analyzerGeneration;
        session
          .syncAndDiagnose(this.path, source, files)
          .then((lspDiags) => {
            if (signal.aborted || this.analyzerGeneration !== generation) return;

            const lspCmDiags = lspDiags.map((d) =>
              lspToCMDiagnostic(view.state, d),
            );
            if (lspCmDiags.length > 0) {
              view.dispatch(setDiagnostics(view.state, lspCmDiags));
              this.options.onDiagnostics?.(lspCmDiags);
            }
          })
          .catch(() => {
            // Analyzer failures are non-fatal — compiler diagnostics are already shown.
          });
      }
    } catch (err) {
      if (signal.aborted) return [];
      diagnostics = [
        {
          from: 0,
          to: Math.min(1, view.state.doc.length),
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
          source: "typst",
        },
      ];
    }

    this.options.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  destroy() {
    this.controller?.abort();
  }
}
