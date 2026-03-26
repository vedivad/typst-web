import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type {
  DiagnosticMessage,
  LspDiagnostic,
} from "@vedivad/typst-web-service";

function getDiagnosticRange(
  state: EditorState,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): Pick<Diagnostic, "from" | "to"> {
  const docLines = state.doc.lines;
  const fromLine = Math.min(startLine + 1, docLines);
  const toLine = Math.min(endLine + 1, docLines);

  let from = state.doc.line(fromLine).from + startCol;
  let to = state.doc.line(toLine).from + endCol;

  const len = state.doc.length;
  from = Math.max(0, Math.min(from, len));
  to = Math.max(from, Math.min(to, len));

  if (from === to && to < len) to += 1;

  return { from, to };
}

export function toCMDiagnostic(
  state: EditorState,
  d: DiagnosticMessage,
): Diagnostic {
  const { startLine, startCol, endLine, endCol } = d.range;
  const { from, to } = getDiagnosticRange(
    state,
    startLine,
    startCol,
    endLine,
    endCol,
  );

  return {
    from,
    to,
    severity: d.severity.toLowerCase() as Diagnostic["severity"],
    message: d.message,
    source: "typst",
  };
}

const LSP_SEVERITY: Record<number, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info", // LSP Hint → CM info
};

export function lspToCMDiagnostic(
  state: EditorState,
  d: LspDiagnostic,
): Diagnostic {
  const { start, end } = d.range;
  const { from, to } = getDiagnosticRange(
    state,
    start.line,
    start.character,
    end.line,
    end.character,
  );

  return {
    from,
    to,
    severity: LSP_SEVERITY[d.severity ?? 1] ?? "error",
    message: d.message,
    source: "tinymist",
  };
}
