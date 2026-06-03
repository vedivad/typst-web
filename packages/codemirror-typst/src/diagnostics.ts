import type { Diagnostic as CMDiagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import { byteToCmOffset, type Diagnostic } from "@vedivad/typst-web-service";

/** Map a typsten diagnostic to a CodeMirror lint diagnostic for `state`'s doc. */
export function toCMDiagnostic(
  state: EditorState,
  d: Diagnostic,
): CMDiagnostic {
  const len = state.doc.length;
  let from = 0;
  let to = 0;
  if (d.location) {
    const source = state.doc.toString();
    from = Math.min(byteToCmOffset(source, d.location.start), len);
    to = Math.min(byteToCmOffset(source, d.location.end), len);
    if (to < from) to = from;
  }
  // Ensure a visible (non-zero-width) span, including for unlocated diagnostics.
  if (from === to && to < len) to += 1;
  const message = d.hints.length
    ? `${d.message}\n\n${d.hints.map((h) => `hint: ${h}`).join("\n")}`
    : d.message;
  return { from, to, severity: d.severity, message, source: "typst" };
}
