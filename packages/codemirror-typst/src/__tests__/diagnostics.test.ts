import { EditorState } from "@codemirror/state";
import type { DiagnosticMessage } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import { toCMDiagnostic } from "../diagnostics.js";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc });
}

describe("toCMDiagnostic", () => {
  it("converts a diagnostic with valid range", () => {
    const state = makeState("hello\nworld\n");
    const diag: DiagnosticMessage = {
      package: "",
      path: "/main.typ",
      severity: "Error",
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 5 },
      message: "test error",
    };
    const result = toCMDiagnostic(state, diag);
    expect(result.from).toBe(0);
    expect(result.to).toBe(5);
    expect(result.severity).toBe("error");
    expect(result.message).toBe("test error");
    expect(result.source).toBe("typst");
  });

  it("maps second line correctly", () => {
    const state = makeState("hello\nworld\n");
    const diag: DiagnosticMessage = {
      package: "",
      path: "/main.typ",
      severity: "Warning",
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 5 },
      message: "second line",
    };
    const result = toCMDiagnostic(state, diag);
    expect(result.from).toBe(6); // "hello\n" = 6 chars
    expect(result.to).toBe(11);
    expect(result.severity).toBe("warning");
  });

  it("clamps out-of-bounds ranges to document length", () => {
    const state = makeState("hi");
    const diag: DiagnosticMessage = {
      package: "",
      path: "/main.typ",
      severity: "Warning",
      range: { startLine: 99, startCol: 0, endLine: 99, endCol: 10 },
      message: "overflow",
    };
    const result = toCMDiagnostic(state, diag);
    expect(result.from).toBeLessThanOrEqual(state.doc.length);
    expect(result.to).toBeLessThanOrEqual(state.doc.length);
  });

  it("ensures minimum one-character span when from === to", () => {
    const state = makeState("abc");
    const diag: DiagnosticMessage = {
      package: "",
      path: "/main.typ",
      severity: "Info",
      range: { startLine: 0, startCol: 1, endLine: 0, endCol: 1 },
      message: "zero-width",
    };
    const result = toCMDiagnostic(state, diag);
    expect(result.to).toBe(result.from + 1);
  });

  it("lowercases severity", () => {
    const state = makeState("x");
    for (const [input, expected] of [
      ["Error", "error"],
      ["Warning", "warning"],
      ["Info", "info"],
    ] as const) {
      const diag: DiagnosticMessage = {
        package: "",
        path: "/main.typ",
        severity: input,
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
        message: "test",
      };
      expect(toCMDiagnostic(state, diag).severity).toBe(expected);
    }
  });
});
