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

vi.mock("../highlight.js", () => ({
  typstHighlighting: vi.fn(() => ({ kind: "highlight" })),
  typstTheme: vi.fn(() => ({ kind: "theme" })),
  // index.js re-exports these; provide them so the re-export resolves.
  defaultDarkTheme: { dark: true },
  defaultLightTheme: { light: true },
}));

import { createTypstCompileSync } from "../compile-sync.js";
import { createTypstDiagnostics } from "../diagnostics-plugin.js";
import {
  typstHighlighting as typstHighlightingImpl,
  typstTheme as typstThemeImpl,
} from "../highlight.js";
import { createTypstHover as createTypstHoverImpl } from "../hover.js";
import {
  createTypstHover,
  createTypstSetup,
  typstCompletionSource,
} from "../index.js";

function mockProject() {
  return {} as never;
}

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

  it("always includes highlighting decorations", () => {
    vi.mocked(typstHighlightingImpl).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({ project, sync: "editor-driven" });

    expect(typstHighlightingImpl).toHaveBeenCalledWith({ project });
    expect(extensions).toContainEqual({ kind: "highlight" });
  });

  it("defaults to a light token theme when none is given", () => {
    vi.mocked(typstThemeImpl).mockClear();
    const project = mockProject();
    const extensions = createTypstSetup({ project, sync: "external" });

    expect(typstThemeImpl).toHaveBeenCalledWith({ light: true });
    expect(extensions).toContainEqual({ kind: "theme" });
  });

  it("uses a provided theme instead of the default", () => {
    vi.mocked(typstThemeImpl).mockClear();
    const project = mockProject();
    const theme = { kind: "custom-theme" };
    const extensions = createTypstSetup({
      project,
      sync: "external",
      theme: theme as never,
    });

    expect(typstThemeImpl).not.toHaveBeenCalled();
    expect(extensions).toContainEqual(theme);
  });
});

describe("granular public APIs", () => {
  it("exports hover and completion helpers from the package entrypoint", () => {
    expect(createTypstHover).toBeTypeOf("function");
    expect(typstCompletionSource).toBeTypeOf("function");
  });
});
