import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstWorkerPlugin } from "./plugin.js";

const DEFAULT_FONTS = [
  "https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-regular-webfont.ttf",
];

// Loaded from CDN by default so users need no bundler WASM config.
// Override with a local path (e.g. via new URL(..., import.meta.url)) for offline/perf.
const DEFAULT_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm";

export interface TypstLinterOptions {
  /** Font URLs to load into the Typst compiler. Defaults to Roboto from jsDelivr. */
  fonts?: string[];
  /**
   * URL to the typst-ts-web-compiler WASM binary.
   * Defaults to the matching version on jsDelivr CDN.
   * Override with a local asset URL for offline support or faster load:
   *   `new URL('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', import.meta.url).href`
   */
  wasmUrl?: string;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Include diagnostics from imported packages, not just the main file. Default: false. */
  includePackageDiagnostics?: boolean;
  /**
   * Optional Web Worker instance to use for compilation.
   * If not provided, the linter creates one automatically via an inlined blob.
   */
  worker?: Worker;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export function typstLinter(options: TypstLinterOptions = {}): Extension {
  const fonts = options.fonts ?? DEFAULT_FONTS;
  const wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
  const delay = options.delay ?? 0;
  const includePackageDiagnostics = options.includePackageDiagnostics ?? false;
  const worker = options.worker;
  const onDiagnostics = options.onDiagnostics;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstWorkerPlugin({
        fonts,
        wasmUrl,
        includePackageDiagnostics,
        worker,
        onDiagnostics,
      }),
    {},
  );

  const linterExtension = linter(
    async (view) => {
      const plugin = view.plugin(workerPlugin);
      if (!plugin) return [];
      return plugin.lint(view);
    },
    { delay },
  );

  return [workerPlugin, linterExtension, lintGutter()];
}
