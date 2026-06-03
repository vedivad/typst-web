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
import type { HlSpan, TypstProject } from "@vedivad/typst-web-service";

/** A token theme: a CodeMirror style spec per Typst `typ-*` class selector. */
export type TokenTheme = Record<string, Record<string, string>>;

export interface TypstHighlightingOptions {
  /** Project whose worker parses the buffer. Share it across editors. */
  project: TypstProject;
  /** Initial theme alias. Defaults to "dark". */
  theme?: string;
  /**
   * Theme palettes by alias. Defaults to the built-in `light` and `dark`. Each
   * maps a `.typ-*` class selector to a CodeMirror style spec. Consumers can also
   * ignore this and style the `typ-*` classes from their own CSS.
   */
  themes?: Record<string, TokenTheme>;
  /** Debounce (ms) before re-highlighting after an edit or scroll. Default: 30. */
  debounceMs?: number;
}

export interface TypstHighlightingController {
  extension: Extension;
  readonly theme: string;
  setTheme(view: EditorView, theme: string): void;
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
const DARK: TokenTheme = {
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
  ".typ-str": { color: "#a5d6ff" },
  ".typ-func": { color: "#d2a8ff" },
  ".typ-pol": { color: "#ffa657" },
  ".typ-error": { color: "#f85149" },
};

const LIGHT: TokenTheme = {
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
  ".typ-str": { color: "#0a3069" },
  ".typ-func": { color: "#8250df" },
  ".typ-pol": { color: "#953800" },
  ".typ-error": { color: "#cf222e" },
};

const DEFAULT_THEMES: Record<string, TokenTheme> = { light: LIGHT, dark: DARK };

/**
 * typst-syntax editor highlighting. Returns a controller whose `extension` you
 * spread into the editor; `setTheme` swaps the token palette live. Synchronous:
 * the worker does the parsing, so there is nothing to preload here.
 *
 * ```ts
 * const project = await TypstProject.create();
 * const highlighting = createTypstHighlighting({ project, theme: "dark" });
 * EditorState.create({ doc, extensions: [basicSetup, ...highlighting.extension] });
 * ```
 */
export function createTypstHighlighting(
  options: TypstHighlightingOptions,
): TypstHighlightingController {
  const { project, debounceMs = 30 } = options;
  const themes = options.themes ?? DEFAULT_THEMES;

  // Resolve an alias to its theme extension, throwing if it is not a known alias.
  const themeFor = (alias: string): Extension => {
    const palette = themes[alias];
    if (!palette) {
      throw new Error(
        `theme alias "${alias}" not found in themes (${Object.keys(themes).join(", ")})`,
      );
    }
    return EditorView.theme(palette, { dark: alias === "dark" });
  };

  let currentAlias =
    options.theme ?? (themes.dark ? "dark" : Object.keys(themes)[0]);
  const themeCompartment = new Compartment();
  const initialTheme = themeFor(currentAlias); // validates the initial alias

  const plugin = ViewPlugin.define(
    (view) => new HighlightPlugin(view, project, debounceMs),
  );

  return {
    extension: [highlightField, plugin, themeCompartment.of(initialTheme)],
    get theme() {
      return currentAlias;
    },
    setTheme(view, alias) {
      const theme = themeFor(alias); // validates before mutating state
      currentAlias = alias;
      view.dispatch({ effects: themeCompartment.reconfigure(theme) });
    },
  };
}
