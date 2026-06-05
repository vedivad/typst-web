import { autocompletion } from "@codemirror/autocomplete";
import { lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { TypstProject } from "@vedivad/typst-web-service";
import { createTypstCompileSync } from "./compile-sync.js";
import type { TypstCompletionOptions } from "./completion.js";
import { typstCompletionSource } from "./completion.js";
import { toCMDiagnostic } from "./diagnostics.js";
import { createTypstDiagnostics } from "./diagnostics-plugin.js";
import {
  diagnosticLocation,
  groupDiagnosticsByFile,
} from "./diagnostics-utils.js";
import { typstFilePath } from "./facets.js";
import type { TypstFormatterOptions } from "./formatter.js";
import { createTypstFormatter } from "./formatter.js";
import {
  defaultLightTheme,
  typstHighlighting,
  typstTheme,
} from "./highlight.js";
import type { TypstHoverOptions } from "./hover.js";
import { createTypstHover } from "./hover.js";

export type {
  ClickJump,
  CompileListener,
  CompileResult,
  Completion,
  CompletionKind,
  CompletionResponse,
  Diagnostic,
  HlSpan,
  Hover,
  HoverKind,
  Location,
  PageInfo,
  Path,
  RenderedSvgPage,
  Severity,
  TypstProjectCreateOptions,
} from "@vedivad/typst-web-service";
export { normalizePath, TypstProject } from "@vedivad/typst-web-service";
export type {
  TokenTheme,
  TypstHighlightingOptions,
  TypstThemeDescriptor,
  TypstThemes,
  TypstThemeSpec,
} from "./highlight.js";
export {
  defaultDarkTheme,
  defaultLightTheme,
  typstHighlighting,
  typstTheme,
  typstThemes,
} from "./highlight.js";
export type {
  TypstCompletionOptions,
  TypstFormatterOptions,
  TypstHoverOptions,
};
export {
  createTypstCompileSync,
  createTypstDiagnostics,
  createTypstFormatter,
  createTypstHover,
  diagnosticLocation,
  groupDiagnosticsByFile,
  toCMDiagnostic,
  typstCompletionSource,
  typstFilePath,
};
export type { CompileSyncOptions } from "./compile-sync.js";
export type { DiagnosticLocation } from "./diagnostics-utils.js";
export type { DiagnosticsPluginOptions } from "./diagnostics-plugin.js";
export { tokenThemeFromHighlightStyle } from "./lezer-theme.js";

// ---------------------------------------------------------------------------
// High-level API: createTypstSetup
// ---------------------------------------------------------------------------

export interface TypstSetupOptions {
  /**
   * Project that owns the VFS. Construct one with `await TypstProject.create()`
   * and share it across editors that should see the same files.
   * Subscribe to compile results with `project.onCompile(listener)`.
   */
  project: TypstProject;
  /**
   * Who owns the canonical text.
   * - `"editor-driven"`: CodeMirror is the source of truth; the setup mirrors
   *   doc/path changes into `project.setText()`.
   * - `"external"`: something else (Y.js, server) pushes into the project; the
   *   setup omits the editor->project sync to avoid double-writes.
   */
  sync: "editor-driven" | "external";
  /**
   * Token theme included in the bundle. Defaults to
   * `typstTheme(defaultLightTheme)` so highlighting is colored out of the box.
   * Pass a `typstTheme(...)` for a different palette, or a
   * `typstThemes(...).extension` to switch themes live.
   */
  theme?: Extension;
  /** Formatter config (the project is taken from this setup). Omit to disable. */
  formatter?: Omit<TypstFormatterOptions, "project">;
}

/**
 * Bundle the default Typst CodeMirror extensions: highlighting, lint gutter,
 * compile-on-edit, diagnostics, autocompletion, hover, and (opt-in) the
 * formatter. The editor's file path is read from the `typstFilePath` facet.
 *
 * Highlighting (decorations + a default light token theme) is included; pass
 * `theme` to override the palette or to switch themes live (see `typstThemes`).
 *
 * ```ts
 * const project = await TypstProject.create();
 * const setup = createTypstSetup({ project, sync: "editor-driven" });
 * const state = EditorState.create({
 *   doc,
 *   extensions: [basicSetup, ...setup, typstFilePath.of("/main.typ")],
 * });
 * ```
 */
export function createTypstSetup(options: TypstSetupOptions): Extension[] {
  const {
    project,
    theme = typstTheme(defaultLightTheme),
    formatter,
    sync,
  } = options;
  return [
    typstHighlighting({ project }),
    theme,
    lintGutter(),
    ...(sync === "editor-driven" ? [createTypstCompileSync({ project })] : []),
    createTypstDiagnostics({ project }),
    autocompletion({ override: [typstCompletionSource({ project })] }),
    createTypstHover({ project }),
    ...(formatter ? [createTypstFormatter({ project, ...formatter })] : []),
  ];
}
