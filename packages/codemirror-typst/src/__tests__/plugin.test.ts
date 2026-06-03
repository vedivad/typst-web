import { EditorState } from "@codemirror/state";
import type { CompileResult, Diagnostic } from "@vedivad/typst-web-service";
import { describe, expect, it, vi } from "vitest";
import { CompileSyncPlugin } from "../compile-sync.js";
import { DiagnosticsPlugin } from "../diagnostics-plugin.js";

function mockView(doc: string) {
  const state = EditorState.create({ doc });
  return { state, dispatch: vi.fn() } as any;
}

function result(diagnostics: Diagnostic[]): CompileResult {
  return { pages: [], diagnostics };
}

function diag(file: string, message: string): Diagnostic {
  return {
    severity: "error",
    message,
    hints: [],
    location: { file, start: 0, end: 3, line: 1, column: 1 },
  };
}

function mockProject(diagnostics: Diagnostic[] = []) {
  const listeners = new Set<(r: CompileResult) => void>();
  const project = {
    setText: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockImplementation(async () => {
      const r = result(diagnostics);
      listeners.forEach((l) => l(r));
      return r;
    }),
    onCompile: vi.fn((listener: (r: CompileResult) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    fire(r: CompileResult) {
      listeners.forEach((l) => l(r));
    },
    listeners,
  };
  return project;
}

function waitFor(fn: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(check, 5);
    };
    check();
  });
}

describe("CompileSyncPlugin", () => {
  it("pushes the editor's content to the project on mount", async () => {
    const project = mockProject();
    const view = mockView("hello");
    new CompileSyncPlugin({ project: project as any }, view);

    await waitFor(() => project.setText.mock.calls.length > 0);
    expect(project.setText).toHaveBeenCalledWith("/main.typ", "hello");
  });

  it("does not call compile() directly — the project auto-schedules", () => {
    const project = mockProject();
    const view = mockView("x");
    new CompileSyncPlugin({ project: project as any }, view);

    expect(project.compile).not.toHaveBeenCalled();
  });

  it("does not subscribe to compile events", () => {
    const project = mockProject();
    const view = mockView("x");
    new CompileSyncPlugin({ project: project as any }, view);

    expect(project.onCompile).not.toHaveBeenCalled();
    expect(project.listeners.size).toBe(0);
  });
});

describe("DiagnosticsPlugin", () => {
  it("subscribes on construction and unsubscribes on destroy", () => {
    const project = mockProject();
    const view = mockView("x");
    const plugin = new DiagnosticsPlugin({ project: project as any }, view);

    expect(project.onCompile).toHaveBeenCalledTimes(1);
    expect(project.listeners.size).toBe(1);

    plugin.destroy();
    expect(project.listeners.size).toBe(0);
  });

  it("does not push content or compile", () => {
    const project = mockProject();
    const view = mockView("x");
    new DiagnosticsPlugin({ project: project as any }, view);

    expect(project.setText).not.toHaveBeenCalled();
    expect(project.compile).not.toHaveBeenCalled();
  });

  it("dispatches diagnostics filtered to the active path", async () => {
    const diags = [diag("main.typ", "bad"), diag("other.typ", "ignored")];
    const project = mockProject(diags);
    const view = mockView("abc");
    new DiagnosticsPlugin({ project: project as any }, view);

    project.fire(result(diags));
    await waitFor(() => view.dispatch.mock.calls.length > 0);
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("reacts to externally-triggered compile events", async () => {
    const project = mockProject();
    const view = mockView("abc");
    new DiagnosticsPlugin({ project: project as any }, view);

    const before = view.dispatch.mock.calls.length;
    project.fire(result([diag("main.typ", "late")]));

    await waitFor(() => view.dispatch.mock.calls.length > before);
    expect(view.dispatch.mock.calls.length).toBe(before + 1);
  });
});
