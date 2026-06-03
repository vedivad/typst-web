import { defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { HlSpan } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import {
  decorationsFor,
  defaultDarkTheme,
  defaultLightTheme,
  highlightField,
  setHighlights,
  typstHighlighting,
  typstTheme,
  typstThemes,
} from "../highlight.js";
import { tokenThemeFromHighlightStyle } from "../lezer-theme.js";

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

describe("typstHighlighting", () => {
  it("installs the highlight field (decorations only, theme-independent)", () => {
    const state = EditorState.create({
      doc: "= Title",
      extensions: [typstHighlighting({ project })],
    });
    // Field present; empty until the worker responds (no view mounted here).
    expect(state.field(highlightField).size).toBe(0);
  });
});

describe("typstTheme", () => {
  it("accepts a built-in TokenTheme", () => {
    const state = EditorState.create({
      doc: "x",
      extensions: [typstTheme(defaultDarkTheme)],
    });
    expect(state).toBeTruthy();
  });

  it("accepts any HighlightStyle (the lezer-tag bridge)", () => {
    const state = EditorState.create({
      doc: "x",
      extensions: [typstTheme(defaultHighlightStyle)],
    });
    expect(state).toBeTruthy();
  });
});

describe("typstThemes", () => {
  it("installs the initial theme and exposes a typed set()", () => {
    const themes = typstThemes(
      {
        light: typstTheme(defaultLightTheme),
        dark: typstTheme(defaultDarkTheme),
      },
      "light",
    );
    // The compartment extension is usable in a state (initial theme installed).
    const state = EditorState.create({
      doc: "x",
      extensions: [themes.extension],
    });
    expect(state).toBeTruthy();
    expect(themes.set).toBeTypeOf("function");
  });

  it("accepts { editor?, tokens } descriptors (bridging the tokens)", () => {
    const themes = typstThemes(
      {
        light: { tokens: defaultLightTheme },
        dark: { editor: [], tokens: defaultHighlightStyle },
      },
      "light",
    );
    const state = EditorState.create({
      doc: "x",
      extensions: [themes.extension],
    });
    expect(state).toBeTruthy();
  });
});

describe("tokenThemeFromHighlightStyle", () => {
  it("derives a typ-* palette from a HighlightStyle's specs", () => {
    const theme = tokenThemeFromHighlightStyle(defaultHighlightStyle);
    // The default style colors keywords and strings, so the bridged Typst
    // classes that map to those tags pick up a color.
    expect(theme[".typ-key"]?.color).toBeTruthy();
    expect(theme[".typ-str"]?.color).toBeTruthy();
    expect(theme[".typ-comment"]?.color).toBeTruthy();
  });

  it("accepts raw TagStyle specs (the form @uiw themes export)", () => {
    const fromStyle = tokenThemeFromHighlightStyle(defaultHighlightStyle);
    const fromSpecs = tokenThemeFromHighlightStyle(defaultHighlightStyle.specs);
    expect(fromSpecs).toEqual(fromStyle);
  });

  it("omits Typst classes the style leaves unstyled", () => {
    const empty = HighlightStyle.define([]);
    expect(tokenThemeFromHighlightStyle(empty)).toEqual({});
  });
});
