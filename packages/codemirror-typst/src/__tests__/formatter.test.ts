import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import type { TypstFormatter } from "@vedivad/typst-web-service";
import { createTypstFormatter } from "../formatter.js";

function mockFormatter(overrides: Partial<TypstFormatter> = {}): TypstFormatter {
  return {
    format: vi.fn().mockResolvedValue("formatted"),
    formatRange: vi.fn().mockResolvedValue({ start: 0, end: 3, text: "fmt" }),
    ...overrides,
  } as any;
}

function mockView(doc: string, selFrom = 0, selTo = 0) {
  const state = EditorState.create({ doc });
  const dispatch = vi.fn();
  return {
    state: {
      ...state,
      doc: state.doc,
      selection: { main: { from: selFrom, to: selTo } },
    },
    dispatch,
  } as any;
}

/** Extract the `run` function for a given key from a keymap extension. */
function getKeyRun(ext: any, key: string): ((view: any) => boolean) | undefined {
  // keymap.of returns a Facet value; walk through to find the binding
  const flat = Array.isArray(ext) ? ext.flat(Infinity) : [ext];
  for (const entry of flat) {
    if (entry?.value) {
      const bindings = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const b of bindings) {
        if (b.key === key) return b.run;
      }
    }
  }
  return undefined;
}

describe("createTypstFormatter", () => {
  it("calls format on the whole document when no selection", async () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({ formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");
    expect(run).toBeDefined();

    const view = mockView("hello");
    run!(view);
    await vi.waitFor(() => {
      expect(formatter.format).toHaveBeenCalledWith("hello");
    });
  });

  it("calls formatRange when selection exists", async () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({ formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");

    const view = mockView("hello world", 0, 5);
    run!(view);
    await vi.waitFor(() => {
      expect(formatter.formatRange).toHaveBeenCalledWith("hello world", 0, 5);
    });
  });

  it("calls onError when formatter rejects", async () => {
    const onError = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue(new Error("wasm broke")),
    });
    const ext = createTypstFormatter({ formatter, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "wasm broke" }));
    });
  });

  it("falls back to console.warn when no onError", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const ext = createTypstFormatter({ formatter });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[typst-formatter]", "boom");
    });
    warnSpy.mockRestore();
  });

  it("wraps non-Error throws in an Error", async () => {
    const onError = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockRejectedValue("string error"),
    });
    const ext = createTypstFormatter({ formatter, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("string error");
    });
  });

  it("adds Mod-s binding when formatOnSave is enabled", () => {
    const formatter = mockFormatter();
    const ext = createTypstFormatter({ formatter, formatOnSave: true });
    const run = getKeyRun(ext, "Mod-s");
    expect(run).toBeDefined();
  });

  it("calls save callback after formatting on Mod-s", async () => {
    const onSave = vi.fn();
    const formatter = mockFormatter({
      format: vi.fn().mockResolvedValue("saved content"),
    });
    const ext = createTypstFormatter({ formatter, formatOnSave: onSave });
    const run = getKeyRun(ext, "Mod-s");

    const view = mockView("original");
    run!(view);
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });
});
