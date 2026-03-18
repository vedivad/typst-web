import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { TypstService } from "@vedivad/typst-web-service";
import { toCMDiagnostic } from "./diagnostics.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import { TypstWorkerPlugin } from "./plugin.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";

export type {
  CompileResult,
  FormatConfig,
  RendererOptions,
} from "@vedivad/typst-web-service";
export { TypstFormatter } from "@vedivad/typst-web-service";
export type {
  TypstFormatterOptions,
  TypstShikiHighlighting,
  TypstShikiOptions,
};
export {
  createTypstFormatter,
  createTypstShikiExtension,
  createTypstShikiHighlighting,
  TypstService,
  toCMDiagnostic,
};

export interface TypstExtensionsOptions {
  /** Options forwarded to the Typst Shiki highlighting factory. */
  highlighting?: TypstShikiOptions;
  /** Options forwarded to the Typst linter extension. */
  compiler: TypstLinterOptions;
  /** Options for the code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
}

export interface TypstLinterOptions {
  /** TypstService instance to use for compilation and diagnostics. */
  service: TypstService;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/**
 * Create a Typst linter extension for CodeMirror.
 *
 *   createTypstLinter({ service, filePath: "/main.typ", onDiagnostics })
 */
export function createTypstLinter(options: TypstLinterOptions): Extension {
  const { service, filePath, getFiles, delay = 0, onDiagnostics } = options;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstWorkerPlugin({
        service,
        filePath,
        getFiles,
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

/**
 * Create the default Typst extension set for CodeMirror.
 */
export async function createTypstExtensions(
  options: TypstExtensionsOptions,
): Promise<Extension[]> {
  const shikiExtension = await createTypstShikiExtension(options.highlighting);
  const linterExtension = createTypstLinter(options.compiler);
  const extensions: Extension[] = [shikiExtension, linterExtension];

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  return extensions;
}
