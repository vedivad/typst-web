// Syntax highlighting driven by Typst's own parser (typst-syntax), via the
// typsten worker. The editor asks `project.highlight(source, from, to)` for the
// visible range; the worker parses with the real engine and returns spans tagged
// with Typst's stable `typ-*` classes (the same `Tag::css_class()` classes the
// official typst.app editor uses), no TextMate grammar to drift from the parser.
//
// Pattern (mirrors diagnostics-plugin.ts): a ViewPlugin requests highlights and
// dispatches a StateEffect; a StateField holds the DecorationSet and maps it
// through edits while the next request is in flight; the field provides the
// editor's decorations. A Compartment swaps the token color palette on demand.
import {
  Compartment,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { HighlightStyle, TagStyle } from "@codemirror/language";
import type { HlSpan, TypstProject } from "@vedivad/typst-web-service";
import { tokenThemeFromHighlightStyle } from "./lezer-theme.js";

/** A token theme: a CodeMirror style spec per Typst `typ-*` class selector. */
export type TokenTheme = Record<string, Record<string, string>>;

export interface TypstHighlightingOptions {
  /** Project whose worker parses the buffer. Share it across editors. */
  project: TypstProject;
  /** Debounce (ms) before re-highlighting after an edit or scroll. Default: 30. */
  debounceMs?: number;
}

/**
 * Replace the highlight decorations with a freshly computed set. Exported (with
 * `highlightField`/`decorationsFor`) so the pure decoration logic is unit-testable
 * without a mounted view; not part of the intended public API.
 */
export const setHighlights = StateEffect.define<DecorationSet>();

// Holds the current highlight decorations. Maps them through edits (so already
// applied highlights track the text until the next request resolves) and swaps
// them wholesale when a `setHighlights` effect arrives.
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlights)) value = effect.value;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Build a sorted `DecorationSet` from worker spans (already in CM offsets). */
export function decorationsFor(
  spans: HlSpan[],
  docLength: number,
): DecorationSet {
  const ranges = [];
  for (const span of spans) {
    const from = Math.max(0, Math.min(span.from, docLength));
    const to = Math.max(0, Math.min(span.to, docLength));
    // Mark decorations must be non-empty; skip zero-width spans.
    if (to > from)
      ranges.push(Decoration.mark({ class: span.tag }).range(from, to));
  }
  // `sort: true` orders by (from, startSide), which nested/overlapping marks need.
  return Decoration.set(ranges, true);
}

class HighlightPlugin implements PluginValue {
  /** Bumped per request; a resolved request only applies if still the latest. */
  private requestId = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly project: TypstProject,
    private readonly debounceMs: number,
  ) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.schedule();
  }

  destroy(): void {
    this.destroyed = true; // an in-flight request checks this before dispatching
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, this.debounceMs);
  }

  private async refresh(): Promise<void> {
    const id = ++this.requestId;
    const requestDoc = this.view.state.doc;
    const { from, to } = this.view.viewport;
    let spans: HlSpan[];
    try {
      spans = await this.project.highlight(requestDoc.toString(), from, to);
    } catch (err) {
      // The worker may still be initialising, or the project torn down.
      console.debug("[typst] highlight request failed", err);
      return;
    }
    // Drop stale results: a newer request superseded this one, the plugin was
    // destroyed, or the document changed since the request (offsets no longer
    // valid, since the edit already scheduled a fresh request).
    if (
      this.destroyed ||
      id !== this.requestId ||
      this.view.state.doc !== requestDoc
    ) {
      return;
    }
    this.view.dispatch({
      effects: setHighlights.of(decorationsFor(spans, requestDoc.length)),
    });
  }
}

// Typst's highlight classes (see `Tag::css_class` in typsten). Colors borrow from
// the GitHub themes; strong/emph/heading carry weight/style, not just hue. Bare
// `.typ-*` selectors so the cascade also reaches highlighted code in hover
// tooltips, which render inside the editor's themed root.
export const defaultDarkTheme: TokenTheme = {
  ".typ-comment": { color: "#8b949e", fontStyle: "italic" },
  ".typ-punct": { color: "#c9d1d9" },
  ".typ-escape": { color: "#79c0ff" },
  ".typ-strong": { fontWeight: "bold" },
  ".typ-emph": { fontStyle: "italic" },
  ".typ-link": { color: "#a5d6ff", textDecoration: "underline" },
  ".typ-raw": { color: "#a5d6ff" },
  ".typ-label": { color: "#d2a8ff" },
  ".typ-ref": { color: "#d2a8ff" },
  ".typ-heading": { color: "#79c0ff", fontWeight: "bold" },
  ".typ-marker": { color: "#ff7b72" },
  ".typ-term": { fontWeight: "bold" },
  ".typ-math-delim": { color: "#ff7b72" },
  ".typ-math-op": { color: "#ff7b72" },
  ".typ-key": { color: "#ff7b72" },
  ".typ-op": { color: "#ff7b72" },
  ".typ-num": { color: "#79c0ff" },
  ".typ-str": { color: "#7ee787" },
  ".typ-func": { color: "#d2a8ff" },
  ".typ-pol": { color: "#ffa657" },
  ".typ-error": { color: "#f85149" },
};

export const defaultLightTheme: TokenTheme = {
  ".typ-comment": { color: "#6e7781", fontStyle: "italic" },
  ".typ-punct": { color: "#24292f" },
  ".typ-escape": { color: "#0550ae" },
  ".typ-strong": { fontWeight: "bold" },
  ".typ-emph": { fontStyle: "italic" },
  ".typ-link": { color: "#0a3069", textDecoration: "underline" },
  ".typ-raw": { color: "#0a3069" },
  ".typ-label": { color: "#8250df" },
  ".typ-ref": { color: "#8250df" },
  ".typ-heading": { color: "#0550ae", fontWeight: "bold" },
  ".typ-marker": { color: "#cf222e" },
  ".typ-term": { fontWeight: "bold" },
  ".typ-math-delim": { color: "#cf222e" },
  ".typ-math-op": { color: "#cf222e" },
  ".typ-key": { color: "#cf222e" },
  ".typ-op": { color: "#cf222e" },
  ".typ-num": { color: "#0550ae" },
  ".typ-str": { color: "#116329" },
  ".typ-func": { color: "#8250df" },
  ".typ-pol": { color: "#953800" },
  ".typ-error": { color: "#cf222e" },
};

/**
 * typst-syntax editor highlighting: the decorations only, theme-independent.
 * The worker does the parsing, so there is nothing to preload. Pair it with a
 * {@link typstTheme} for the token colors (typically in a `Compartment` so you
 * can swap themes live).
 *
 * ```ts
 * const project = await TypstProject.create();
 * const theme = new Compartment();
 * EditorState.create({
 *   doc,
 *   extensions: [
 *     basicSetup,
 *     typstHighlighting({ project }),
 *     oneDark, // chrome theme owns the dark/light base
 *     theme.of(typstTheme(defaultDarkTheme)),
 *   ],
 * });
 * // later: view.dispatch({ effects: theme.reconfigure(typstTheme(defaultLightTheme)) });
 * ```
 */
export function typstHighlighting(
  options: TypstHighlightingOptions,
): Extension {
  const { project, debounceMs = 30 } = options;
  return [
    highlightField,
    ViewPlugin.define((view) => new HighlightPlugin(view, project, debounceMs)),
  ];
}

/**
 * The Typst token palette as a CodeMirror theme extension: just the `typ-*`
 * color rules. Accepts a {@link TokenTheme}, any CodeMirror `HighlightStyle`, or
 * its raw `TagStyle[]` specs (the form `@uiw` themes export), styles are bridged
 * via {@link tokenThemeFromHighlightStyle}, so the whole CodeMirror theme
 * ecosystem works. Drop it in a `Compartment` - typically next to
 * your editor chrome theme - and reconfigure to switch. The editor's dark/light
 * base is the chrome theme's job (`oneDark`, `githubLight`, ...), so this sets no
 * dark flag of its own.
 */
export function typstTheme(
  theme: TokenTheme | HighlightStyle | readonly TagStyle[],
): Extension {
  // A TokenTheme is a plain `.typ-*` -> spec object; a HighlightStyle has a
  // `.style()` method; a TagStyle[] is the raw specs (as `@uiw` themes export).
  const isPalette =
    !Array.isArray(theme) &&
    typeof (theme as HighlightStyle).style !== "function";
  const palette = isPalette
    ? (theme as TokenTheme)
    : tokenThemeFromHighlightStyle(
        theme as HighlightStyle | readonly TagStyle[],
      );
  return EditorView.theme(palette);
}

/**
 * A descriptor for one theme entry: an optional editor chrome theme paired with
 * a `tokens` style that is bridged to Typst's `typ-*` colors via {@link typstTheme}.
 */
export interface TypstThemeDescriptor {
  /** Editor chrome theme (background, gutter, selection), e.g. `githubDark`. */
  editor?: Extension;
  /** Token style, bridged to a `typ-*` palette. */
  tokens: TokenTheme | HighlightStyle | readonly TagStyle[];
}

/** One entry in a {@link typstThemes} selection: a ready Extension, or a
 *  {@link TypstThemeDescriptor} whose `tokens` are bridged for you. */
export type TypstThemeSpec = Extension | TypstThemeDescriptor;

/** A live-switchable selection of editor themes, backed by a `Compartment`. */
export interface TypstThemes<K extends string> {
  /** Add this to the editor (or pass it as `createTypstSetup`'s `theme`). */
  readonly extension: Extension;
  /** Switch `view` to the theme registered under `key`. */
  set(view: EditorView, key: K): void;
}

function isThemeDescriptor(spec: TypstThemeSpec): spec is TypstThemeDescriptor {
  return (
    typeof spec === "object" &&
    spec !== null &&
    !Array.isArray(spec) &&
    "tokens" in spec
  );
}

// Expand a spec into a plain Extension: a descriptor becomes `[editor, tokens]`
// with the token style bridged; a ready Extension passes through.
function resolveThemeSpec(spec: TypstThemeSpec): Extension {
  return isThemeDescriptor(spec)
    ? [spec.editor ?? [], typstTheme(spec.tokens)]
    : spec;
}

/**
 * Bundle a named selection of editor themes behind one `Compartment`, with a
 * single `set(view, key)` switch point. The consumer owns the selection, two
 * entries for a light/dark toggle, more for a picker. Each entry is a
 * {@link TypstThemeDescriptor} (`{ editor?, tokens }`, with `tokens` bridged for
 * you) or a ready `Extension`.
 *
 * ```ts
 * const themes = typstThemes(
 *   {
 *     light: { editor: githubLight, tokens: githubLightStyle },
 *     dark: { editor: githubDark, tokens: githubDarkStyle },
 *   },
 *   "light",
 * );
 * // include themes.extension (or pass it as createTypstSetup's `theme`);
 * // toggle with themes.set(view, "dark").
 * ```
 *
 * `set` is per-view (it dispatches a reconfigure to that editor), so a
 * multi-view app re-applies the active key when a view mounts. There is no hidden
 * "current" state, track the active key yourself.
 */
export function typstThemes<const K extends string>(
  themes: Record<K, TypstThemeSpec>,
  initial: NoInfer<K>,
): TypstThemes<K> {
  const resolved = Object.fromEntries(
    Object.entries<TypstThemeSpec>(themes).map(([key, spec]) => [
      key,
      resolveThemeSpec(spec),
    ]),
  ) as Record<K, Extension>;
  const compartment = new Compartment();
  return {
    extension: compartment.of(resolved[initial]),
    set: (view, key) =>
      view.dispatch({ effects: compartment.reconfigure(resolved[key]) }),
  };
}
