import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import type {
  DiagnosticMessage,
  TypstService,
} from "@vedivad/typst-web-service";
import { TypstWorkerPlugin } from "../plugin.js";

function mockView(doc: string) {
  const state = EditorState.create({ doc });
  return { state } as any;
}

function mockService(diagnostics: DiagnosticMessage[] = []): TypstService {
  return {
    compile: vi.fn().mockResolvedValue({ diagnostics }),
  } as any;
}

describe("TypstWorkerPlugin", () => {
  it("returns diagnostics filtered by file path", async () => {
    const diags: DiagnosticMessage[] = [
      {
        package: "",
        path: "/main.typ",
        severity: "Error",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 3 },
        message: "bad",
      },
      {
        package: "",
        path: "/other.typ",
        severity: "Warning",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
        message: "ignored",
      },
    ];
    const service = mockService(diags);
    const plugin = new TypstWorkerPlugin({ service });
    const result = await plugin.lint(mockView("abc"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("bad");
  });

  it("returns error diagnostic when compile throws", async () => {
    const service = {
      compile: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const plugin = new TypstWorkerPlugin({ service });
    const result = await plugin.lint(mockView("x"));
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toBe("boom");
  });

  it("calls onDiagnostics callback", async () => {
    const onDiagnostics = vi.fn();
    const service = mockService([]);
    const plugin = new TypstWorkerPlugin({ service, onDiagnostics });
    await plugin.lint(mockView(""));
    expect(onDiagnostics).toHaveBeenCalledWith([]);
  });

  it("passes merged files to service.compile", async () => {
    const service = mockService();
    const getFiles = () => ({ "/lib.typ": "// lib" });
    const plugin = new TypstWorkerPlugin({
      service,
      filePath: "/main.typ",
      getFiles,
    });
    await plugin.lint(mockView("hello"));
    expect(service.compile).toHaveBeenCalledWith({
      "/lib.typ": "// lib",
      "/main.typ": "hello",
    });
  });

  it("uses /main.typ as default file path", async () => {
    const service = mockService();
    const plugin = new TypstWorkerPlugin({ service });
    await plugin.lint(mockView("content"));
    expect(service.compile).toHaveBeenCalledWith({
      "/main.typ": "content",
    });
  });

  it("returns empty diagnostics when aborted", async () => {
    const service = {
      compile: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            // simulate slow compile
            setTimeout(
              () => resolve({ diagnostics: [{ path: "/main.typ", severity: "Error", range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 }, message: "late", package: "" }] }),
              10,
            );
          }),
      ),
    } as any;
    const plugin = new TypstWorkerPlugin({ service });
    const view = mockView("x");

    // Start first lint, then immediately start second (aborts first)
    const first = plugin.lint(view);
    const second = plugin.lint(view);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual([]);
    expect(secondResult).toHaveLength(1);
  });
});
