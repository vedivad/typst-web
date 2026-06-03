import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { typstFilePath } from "../facets.js";
import { createTypstFormatter, diffChanges } from "../formatter.js";

function mockProject(format = vi.fn().mockResolvedValue("formatted")) {
  return { format } as any;
}

function mockState(doc: string) {
  const state = EditorState.create({ doc });
  return {
    doc: state.doc,
    facet: (f: unknown) => (f === typstFilePath ? "/main.typ" : undefined),
  };
}

function mockView(doc: string) {
  return { state: mockState(doc), dispatch: vi.fn() } as any;
}

function mutableMockView(doc: string) {
  const dispatch = vi.fn();
  const view = {
    state: mockState(doc),
    dispatch,
    setDoc(next: string) {
      view.state.doc = EditorState.create({ doc: next }).doc;
    },
  };
  return view as any;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Extract the `run` function for a given key from a keymap extension. */
function getKeyRun(
  ext: any,
  key: string,
): ((view: any) => boolean) | undefined {
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

describe("diffChanges", () => {
  it("returns empty array for identical strings", () => {
    expect(diffChanges("hello\nworld", "hello\nworld")).toEqual([]);
  });

  it("produces a single change for a modified middle line", () => {
    expect(diffChanges("aaa\nbbb\nccc", "aaa\nBBB\nccc")).toEqual([
      { from: 4, to: 7, insert: "BBB" },
    ]);
  });

  it("handles added lines", () => {
    const old = "aaa\nccc";
    const now = "aaa\nbbb\nccc";
    const [c] = diffChanges(old, now);
    expect(old.slice(0, c.from) + c.insert + old.slice(c.to)).toBe(now);
  });

  it("handles removed lines", () => {
    const old = "aaa\nbbb\nccc";
    const now = "aaa\nccc";
    const [c] = diffChanges(old, now);
    expect(old.slice(0, c.from) + c.insert + old.slice(c.to)).toBe(now);
  });

  it("handles change at the beginning", () => {
    expect(diffChanges("aaa\nbbb", "AAA\nbbb")).toEqual([
      { from: 0, to: 3, insert: "AAA" },
    ]);
  });

  it("handles change at the end", () => {
    expect(diffChanges("aaa\nbbb", "aaa\nBBB")).toEqual([
      { from: 4, to: 7, insert: "BBB" },
    ]);
  });

  it("handles empty to non-empty", () => {
    expect(diffChanges("", "hello")).toEqual([
      { from: 0, to: 0, insert: "hello" },
    ]);
  });

  it("handles non-empty to empty", () => {
    expect(diffChanges("hello", "")).toEqual([{ from: 0, to: 5, insert: "" }]);
  });
});

describe("createTypstFormatter", () => {
  it("formats the whole document via the project", async () => {
    const project = mockProject();
    const ext = createTypstFormatter({ project });
    const run = getKeyRun(ext, "Shift-Alt-f");
    expect(run).toBeDefined();

    run!(mockView("hello"));
    await vi.waitFor(() => {
      expect(project.format).toHaveBeenCalledWith("/main.typ", "hello");
    });
  });

  it("skips dispatch when the document changes before formatting resolves", async () => {
    const pending = deferred<string>();
    const project = mockProject(vi.fn().mockReturnValue(pending.promise));
    const ext = createTypstFormatter({ project });
    const run = getKeyRun(ext, "Shift-Alt-f");
    const view = mutableMockView("original");

    run!(view);
    await vi.waitFor(() => {
      expect(project.format).toHaveBeenCalledWith("/main.typ", "original");
    });
    view.setDoc("original plus typing");
    pending.resolve("formatted");
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when format returns undefined (not formattable)", async () => {
    const project = mockProject(vi.fn().mockResolvedValue(undefined));
    const ext = createTypstFormatter({ project });
    const run = getKeyRun(ext, "Shift-Alt-f");
    const view = mockView("x");

    run!(view);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("calls onError when format rejects", async () => {
    const onError = vi.fn();
    const project = mockProject(vi.fn().mockRejectedValue(new Error("wasm broke")));
    const ext = createTypstFormatter({ project, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "wasm broke" }),
      );
    });
  });

  it("falls back to console.warn when no onError", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const project = mockProject(vi.fn().mockRejectedValue(new Error("boom")));
    const ext = createTypstFormatter({ project });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[typst-formatter]", "boom");
    });
    warnSpy.mockRestore();
  });

  it("wraps non-Error throws in an Error", async () => {
    const onError = vi.fn();
    const project = mockProject(vi.fn().mockRejectedValue("string error"));
    const ext = createTypstFormatter({ project, onError });
    const run = getKeyRun(ext, "Shift-Alt-f");

    run!(mockView("x"));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("string error");
    });
  });

  it("adds Mod-s binding when formatOnSave is enabled", () => {
    const ext = createTypstFormatter({ project: mockProject(), formatOnSave: true });
    expect(getKeyRun(ext, "Mod-s")).toBeDefined();
  });

  it("calls the save callback after formatting on Mod-s", async () => {
    const onSave = vi.fn();
    const project = mockProject(vi.fn().mockResolvedValue("saved content"));
    const ext = createTypstFormatter({ project, formatOnSave: onSave });
    const run = getKeyRun(ext, "Mod-s");

    run!(mockView("original"));
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it("does not call the save callback when the document changes mid-format", async () => {
    const onSave = vi.fn();
    const pending = deferred<string>();
    const project = mockProject(vi.fn().mockReturnValue(pending.promise));
    const ext = createTypstFormatter({ project, formatOnSave: onSave });
    const run = getKeyRun(ext, "Mod-s");
    const view = mutableMockView("original");

    run!(view);
    await vi.waitFor(() => {
      expect(project.format).toHaveBeenCalledWith("/main.typ", "original");
    });
    view.setDoc("changed");
    pending.resolve("formatted");
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
