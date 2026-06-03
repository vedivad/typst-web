import { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import { toCMDiagnostic } from "../diagnostics.js";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc });
}

function diag(over: Partial<Diagnostic>): Diagnostic {
  return {
    severity: "error",
    message: "test",
    hints: [],
    location: undefined,
    ...over,
  };
}

describe("toCMDiagnostic", () => {
  it("converts a diagnostic with a byte range", () => {
    const state = makeState("hello\nworld\n");
    const result = toCMDiagnostic(
      state,
      diag({
        message: "test error",
        location: { file: "main.typ", start: 0, end: 5, line: 1, column: 1 },
      }),
    );
    expect(result.from).toBe(0);
    expect(result.to).toBe(5);
    expect(result.severity).toBe("error");
    expect(result.message).toBe("test error");
    expect(result.source).toBe("typst");
  });

  it("maps a second-line range (after the 6-byte first line)", () => {
    const state = makeState("hello\nworld\n");
    const result = toCMDiagnostic(
      state,
      diag({
        severity: "warning",
        location: { file: "main.typ", start: 6, end: 11, line: 2, column: 1 },
      }),
    );
    expect(result.from).toBe(6);
    expect(result.to).toBe(11);
    expect(result.severity).toBe("warning");
  });

  it("clamps out-of-bounds ranges to document length", () => {
    const state = makeState("hi");
    const result = toCMDiagnostic(
      state,
      diag({
        location: { file: "main.typ", start: 99, end: 110, line: 1, column: 1 },
      }),
    );
    expect(result.from).toBeLessThanOrEqual(state.doc.length);
    expect(result.to).toBeLessThanOrEqual(state.doc.length);
  });

  it("ensures a one-character span when from === to", () => {
    const state = makeState("abc");
    const result = toCMDiagnostic(
      state,
      diag({
        location: { file: "main.typ", start: 1, end: 1, line: 1, column: 2 },
      }),
    );
    expect(result.to).toBe(result.from + 1);
  });

  it("places an unlocated diagnostic at the document start", () => {
    const result = toCMDiagnostic(makeState("x"), diag({ message: "no loc" }));
    expect(result.from).toBe(0);
    expect(result.to).toBe(1);
  });

  it("appends hints to the message", () => {
    const result = toCMDiagnostic(
      makeState("x"),
      diag({
        message: "bad",
        hints: ["try this"],
        location: { file: "main.typ", start: 0, end: 1, line: 1, column: 1 },
      }),
    );
    expect(result.message).toContain("bad");
    expect(result.message).toContain("try this");
  });
});
