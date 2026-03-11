import type { Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { toCMDiagnostic } from "./diagnostics.js";
import { createWorker, workerRpc } from "./rpc.js";

export interface PluginOptions {
  fonts: string[];
  wasmUrl: string;
  includePackageDiagnostics: boolean;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  worker?: Worker;
}

export class TypstWorkerPlugin {
  private worker: Worker;
  private ready: Promise<void>;
  private idCounter = 0;
  private latestId = 0;

  constructor(private options: PluginOptions) {
    this.worker = options.worker || createWorker();

    this.ready = workerRpc(
      this.worker,
      {
        type: "init",
        id: ++this.idCounter,
        wasmUrl: options.wasmUrl,
        fonts: options.fonts,
      },
      60_000,
    ).then((res) => {
      if (res.type === "error")
        throw new Error(`typstLinter worker init failed: ${res.message}`);
    });
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
    await this.ready;

    const id = ++this.idCounter;
    this.latestId = id;

    const source = view.state.doc.toString();
    const response = await workerRpc(this.worker, {
      type: "compile",
      id,
      source,
    });

    // Drop stale results
    if (id !== this.latestId) return [];

    let diagnostics: Diagnostic[];

    if (response.type !== "result") {
      if (response.type === "error") {
        diagnostics = [
          {
            from: 0,
            to: Math.min(1, view.state.doc.length),
            severity: "error",
            message: response.message,
            source: "typst",
          },
        ];
      } else {
        diagnostics = [];
      }
    } else {
      diagnostics = response.diagnostics
        .filter(
          (d) => this.options.includePackageDiagnostics || d.package === "",
        )
        .map((d) => toCMDiagnostic(view.state, d));
    }

    this.options.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  destroy() {
    const id = ++this.idCounter;
    workerRpc(this.worker, { type: "destroy", id }, 5_000)
      .catch(() => {
        /* worker may already be unresponsive */
      })
      .finally(() => this.worker.terminate());
  }
}
