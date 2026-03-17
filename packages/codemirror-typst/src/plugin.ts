import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { TypstService } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";

export interface PluginOptions {
  service: TypstService;
  onDestroy?: () => void;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export class TypstWorkerPlugin {
  private controller: AbortController | null = null;

  constructor(private options: PluginOptions) {}

  async lint(view: EditorView): Promise<Diagnostic[]> {
    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const source = view.state.doc.toString();

    let diagnostics: Diagnostic[];

    try {
      const result = await this.options.service.compile(source);

      if (signal.aborted) return [];

      diagnostics = result.diagnostics.map((d) =>
        toCMDiagnostic(view.state, d),
      );
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
    this.options.onDestroy?.();
  }
}
