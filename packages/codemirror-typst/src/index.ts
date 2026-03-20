import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { CompileResult, TypstAnalyzer, TypstCompiler } from "@vedivad/typst-web-service";
import { lspToCMDiagnostic, toCMDiagnostic } from "./diagnostics.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import { TypstLinterPlugin } from "./plugin.js";
import type { TypstShikiHighlighting, TypstShikiOptions } from "./shiki.js";
import {
  createTypstShikiExtension,
  createTypstShikiHighlighting,
} from "./shiki.js";

export type {
  CompileResult,
  FormatConfig,
  LspDiagnostic,
  TypstCompilerOptions,
  TypstRendererOptions,
} from "@vedivad/typst-web-service";
export {
  AnalyzerSession,
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
  TypstRenderer,
} from "@vedivad/typst-web-service";
export type {
  TypstFormatterOptions,
  TypstShikiHighlighting,
  TypstShikiOptions,
};
export {
  createTypstFormatter,
  createTypstShikiExtension,
  createTypstShikiHighlighting,
  lspToCMDiagnostic,
  toCMDiagnostic,
};

export interface TypstExtensionsOptions {
  /** Options forwarded to the Typst Shiki highlighting factory. */
  highlighting?: TypstShikiOptions;
  /** Options forwarded to the Typst linter extension. */
  linter: TypstLinterOptions;
  /** Options for the code formatter. Omit to disable. */
  formatter?: TypstFormatterOptions;
}

export interface TypstLinterOptions {
  /** TypstCompiler instance to use for compilation. */
  compiler: TypstCompiler;
  /** tinymist analyzer for richer LSP diagnostics. Optional. */
  analyzer?: TypstAnalyzer;
  /** File path this editor represents. Default: "/main.typ" */
  filePath?: string;
  /** Return all project files. The editor's content is included automatically under filePath. */
  getFiles?: () => Record<string, string>;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Optional root path for auto-created analyzer sessions. Default: "/project". */
  projectRootPath?: string;
  /** Optional entry path for auto-created analyzer sessions. Default: "/main.typ". */
  projectEntryPath?: string;
  /** Called after each successful compile with the full result (e.g. for SVG preview). */
  onCompile?: (result: CompileResult) => void;
  /** Called after each lint pass with the resulting diagnostics. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/**
 * Create a Typst linter extension for CodeMirror.
 *
 *   createTypstLinter({ compiler, filePath: "/main.typ", onDiagnostics })
 */
export function createTypstLinter(options: TypstLinterOptions): Extension {
  const {
    compiler,
    analyzer,
    filePath,
    getFiles,
    delay = 0,
    projectRootPath,
    projectEntryPath,
    onCompile,
    onDiagnostics,
  } = options;

  const workerPlugin = ViewPlugin.define(
    () =>
      new TypstLinterPlugin({
        compiler,
        analyzer,
        filePath,
        getFiles,
        projectRootPath,
        projectEntryPath,
        onCompile,
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
  const linterExtension = createTypstLinter(options.linter);
  const extensions: Extension[] = [shikiExtension, linterExtension];

  if (options.formatter) {
    extensions.push(createTypstFormatter(options.formatter));
  }

  return extensions;
}
