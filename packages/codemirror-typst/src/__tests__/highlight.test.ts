import { EditorState } from "@codemirror/state";
import type { HlSpan } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import {
  createTypstHighlighting,
  decorationsFor,
  highlightField,
  setHighlights,
} from "../highlight.js";

const project = {} as never; // the controller only stores it; no calls in these tests

function classesAt(state: EditorState): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  const set = state.field(highlightField);
  const cursor = set.iter();
  while (cursor.value) {
    out.push([cursor.from, cursor.to, cursor.value.spec.class as string]);
    cursor.next();
  }
  return out;
}

describe("decorationsFor", () => {
  it("keeps nested/overlapping spans as separate marks", () => {
    const spans: HlSpan[] = [
      { from: 0, to: 6, tag: "typ-strong" },
      { from: 1, to: 5, tag: "typ-func" },
    ];
    const set = decorationsFor(spans, 6);
    expect(set.size).toBe(2);
  });

  it("drops empty spans and clamps to the document length", () => {
    const spans: HlSpan[] = [
      { from: 2, to: 2, tag: "typ-num" }, // empty -> skipped
      { from: 3, to: 99, tag: "typ-key" }, // clamped to docLength
    ];
    const set = decorationsFor(spans, 5);
    const ranges: Array<[number, number]> = [];
    const cursor = set.iter();
    while (cursor.value) {
      ranges.push([cursor.from, cursor.to]);
      cursor.next();
    }
    expect(ranges).toEqual([[3, 5]]);
  });
});

describe("highlightField", () => {
  it("holds the set from a setHighlights effect", () => {
    let state = EditorState.create({
      doc: "= Title",
      extensions: [highlightField],
    });
    state = state.update({
      effects: setHighlights.of(
        decorationsFor([{ from: 0, to: 7, tag: "typ-heading" }], 7),
      ),
    }).state;
    expect(classesAt(state)).toEqual([[0, 7, "typ-heading"]]);
  });

  it("maps decorations through edits while a new request is in flight", () => {
    let state = EditorState.create({ doc: "ab", extensions: [highlightField] });
    state = state.update({
      effects: setHighlights.of(
        decorationsFor([{ from: 0, to: 2, tag: "typ-str" }], 2),
      ),
    }).state;
    // Insert two chars at the start: the span should shift to [2, 4).
    state = state.update({ changes: { from: 0, insert: "XY" } }).state;
    expect(classesAt(state)).toEqual([[2, 4, "typ-str"]]);
  });
});

describe("createTypstHighlighting", () => {
  it("defaults to the dark theme and exposes a controller", () => {
    const controller = createTypstHighlighting({ project });
    expect(controller.theme).toBe("dark");
    expect(Array.isArray(controller.extension)).toBe(true);
  });

  it("honours an initial theme alias", () => {
    expect(createTypstHighlighting({ project, theme: "light" }).theme).toBe(
      "light",
    );
  });

  it("rejects an unknown theme alias", () => {
    expect(() => createTypstHighlighting({ project, theme: "nope" })).toThrow(
      /not found in themes/,
    );
  });
});
