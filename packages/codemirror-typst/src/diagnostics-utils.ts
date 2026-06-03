import { type Diagnostic, normalizePath } from "@vedivad/typst-web-service";

export interface DiagnosticLocation {
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
}

/** Group diagnostics by file path (preserving per-file order). Unlocated ones key on "". */
export function groupDiagnosticsByFile(
  diagnostics: readonly Diagnostic[],
): Record<string, Diagnostic[]> {
  const grouped: Record<string, Diagnostic[]> = {};
  for (const d of diagnostics) {
    const path = d.location ? normalizePath(d.location.file) : "";
    (grouped[path] ??= []).push(d);
  }
  return grouped;
}

/** A diagnostic's 1-based start location, or `undefined` if it has no location. */
export function diagnosticLocation(
  d: Diagnostic,
): DiagnosticLocation | undefined {
  if (!d.location) return undefined;
  return {
    path: normalizePath(d.location.file),
    line: d.location.line,
    col: d.location.column,
  };
}
