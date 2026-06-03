import { describe, expect, it, vi } from "vitest";

vi.mock("../compile-sync.js", () => ({
  createTypstCompileSync: vi.fn(() => ({ kind: "compile-sync" })),
}));

vi.mock("../diagnostics-plugin.js", () => ({
  createTypstDiagnostics: vi.fn(() => ({ kind: "diagnostics" })),
}));

vi.mock("../hover.js", () => ({
  createTypstHover: vi.fn(() => ({ kind: "hover" })),
}));

import { createTypstCompileSync } from "../compile-sync.js";
import { createTypstDiagnostics } from "../diagnostics-plugin.js";
import { createTypstHover as createTypstHoverImpl } from "../hover.js";
import {
  createTypstHover,
  createTypstSetup,
  typstCompletionSource,
} from "../index.js";

function mockProject() {
  return {} as never;
}

const stubHighlighting = {
  extension: { kind: "highlight" },
  theme: "dark",
  setTheme: vi.fn(),
};

describe("createTypstSetup", () => {
  it('includes compile sync when sync is "editor-driven"', () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({ project, sync: "editor-driven" });

    expect(createTypstCompileSync).toHaveBeenCalledWith({ project });
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it('omits compile sync when sync is "external" but keeps diagnostics', () => {
    vi.mocked(createTypstCompileSync).mockClear();
    vi.mocked(createTypstDiagnostics).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({ project, sync: "external" });

    expect(createTypstCompileSync).not.toHaveBeenCalled();
    expect(createTypstDiagnostics).toHaveBeenCalledWith({ project });
    expect(extensions).not.toContainEqual({ kind: "compile-sync" });
    expect(extensions).toContainEqual({ kind: "diagnostics" });
  });

  it("always wires hover (typsten has built-in analysis)", () => {
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({ project, sync: "editor-driven" });

    expect(extensions).toContainEqual({ kind: "hover" });
    expect(createTypstHoverImpl).toHaveBeenCalledWith({ project });
  });

  it("wires the highlighting controller's extension into the bundle", () => {
    vi.mocked(createTypstHoverImpl).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({
      project,
      sync: "editor-driven",
      highlighting: stubHighlighting as never,
    });

    // Highlighting is an independent extension; hover no longer depends on it.
    expect(extensions).toContain(stubHighlighting.extension);
    expect(createTypstHoverImpl).toHaveBeenCalledWith({ project });
  });
});

describe("granular public APIs", () => {
  it("exports hover and completion helpers from the package entrypoint", () => {
    expect(createTypstHover).toBeTypeOf("function");
    expect(typstCompletionSource).toBeTypeOf("function");
  });
});
