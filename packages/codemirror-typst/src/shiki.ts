import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LanguageRegistration } from "shiki";

/**
 * Fix the raw-block rule in shiki's bundled Typst grammar.
 *
 * Upstream (`@shikijs/langs`) ships `markup.raw.block.typst` with `end: "\x00"`,
 * a null byte that never appears in source. The result: opening a ```` ``` ````
 * fence makes the block run to the end of the document, so every heading, list,
 * and markup token after a code snippet loses its highlighting. We replace the
 * end with a backreference to the opening run of backticks so the block closes
 * on a matching fence, as Typst actually parses it.
 *
 * Mutates `grammar` in place and returns it.
 */
export function patchTypstRawBlock(
  grammar: LanguageRegistration,
): LanguageRegistration {
  const patterns = grammar.repository?.["markup"]?.patterns as
    | { name?: string; begin?: string; end?: string; captures?: unknown }[]
    | undefined;
  const raw = patterns?.find((p) => p.name === "markup.raw.block.typst");
  if (raw && raw.end === "\\x00") {
    raw.begin = "(`{3,})";
    raw.end = "\\1";
    delete raw.captures;
    Object.assign(raw, {
      beginCaptures: { "1": { name: "punctuation.definition.raw.typst" } },
      endCaptures: { "1": { name: "punctuation.definition.raw.typst" } },
    });
  }
  return grammar;
}

async function loadPatchedTypstGrammar(): Promise<LanguageRegistration> {
  const { bundledLanguages } = await import("shiki");
  const mod = await bundledLanguages.typst();
  const [grammar] = structuredClone(mod.default);
  if (!grammar) {
    throw new Error("shiki did not provide a Typst grammar");
  }
  return patchTypstRawBlock(grammar);
}

export interface TypstHighlightingOptions {
  /** Initial theme alias to use. Defaults to "dark" when available. */
  theme?: string;
  /** Full theme map. Overrides `theme` shorthand if both are set. */
  themes?: Record<string, string>;
  /** Regex engine used by shiki. Default: "javascript". */
  engine?: "javascript" | "oniguruma";
}

export interface TypstHighlightingController {
  extension: Extension;
  readonly theme: string;
  setTheme(view: EditorView, theme: string): void;
  /** Highlight a code string to HTML. Falls back to Typst highlighting for unknown languages. */
  highlightCode(code: string, language: string): string;
}

export async function createTypstHighlighting(
  options: TypstHighlightingOptions = {},
): Promise<TypstHighlightingController> {
  const {
    createHighlighter,
    createJavaScriptRegexEngine,
    createOnigurumaEngine,
  } = await import("shiki");
  const { default: shiki, synchronousHighlightEffect } =
    await import("codemirror-shiki");

  const themes = options.themes ?? {
    light: "github-light",
    dark: "github-dark",
  };
  let currentAlias =
    options.theme ?? (themes.dark ? "dark" : Object.keys(themes)[0]);
  if (!themes[currentAlias]) {
    throw new Error(
      `theme alias "${currentAlias}" not found in themes (${Object.keys(themes).join(", ")})`,
    );
  }

  const engine =
    options.engine === "oniguruma"
      ? createOnigurumaEngine(import("shiki/wasm"))
      : createJavaScriptRegexEngine();

  // Keep as a promise — codemirror-shiki resolves it asynchronously to avoid
  // re-entrant EditorView.update calls during construction.
  const highlighterPromise = createHighlighter({
    langs: [await loadPatchedTypstGrammar()],
    themes: Array.from(new Set(Object.values(themes))),
    engine,
  });
  const highlighter = await highlighterPromise;

  const compartment = new Compartment();

  const buildExtension = (theme: string): Extension =>
    shiki({ highlighter: highlighterPromise, language: "typst", theme });

  const highlightCode = (code: string, language: string): string => {
    const lang = highlighter.getLoadedLanguages().includes(language)
      ? language
      : "typst";
    return highlighter.codeToHtml(code, { lang, theme: themes[currentAlias] });
  };

  return {
    extension: compartment.of(buildExtension(themes[currentAlias])),
    get theme() {
      return currentAlias;
    },
    setTheme(view, theme) {
      if (!themes[theme]) {
        throw new Error(
          `theme alias "${theme}" not found in themes (${Object.keys(themes).join(", ")})`,
        );
      }
      currentAlias = theme;
      view.dispatch({
        effects: [
          compartment.reconfigure(buildExtension(themes[theme])),
          synchronousHighlightEffect.of(null),
        ],
      });
    },
    highlightCode,
  };
}
