import type { Diagnostic } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import {
  diagnosticLocation,
  groupDiagnosticsByFile,
} from "../diagnostics-utils.js";

function diag(
  file: string,
  line: number,
  column: number,
  message: string,
): Diagnostic {
  return {
    severity: "warning",
    message,
    hints: [],
    location: { file, start: 0, end: 1, line, column },
  };
}

const DIAG_A = diag("b.typ", 5, 3, "B");
const DIAG_B = diag("a.typ", 2, 9, "A2");
const DIAG_C = diag("a.typ", 1, 2, "A1");

describe("diagnostics-utils", () => {
  it("groups diagnostics by (normalized) file path", () => {
    const grouped = groupDiagnosticsByFile([DIAG_A, DIAG_B, DIAG_C]);
    expect(Object.keys(grouped).sort()).toEqual(["/a.typ", "/b.typ"]);
    expect(grouped["/a.typ"]).toEqual([DIAG_B, DIAG_C]);
    expect(grouped["/b.typ"]).toEqual([DIAG_A]);
  });

  it("returns 1-based diagnostic location", () => {
    expect(diagnosticLocation(DIAG_A)).toEqual({
      path: "/b.typ",
      line: 5,
      col: 3,
    });
  });
});
