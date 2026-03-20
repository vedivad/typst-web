import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface TypstShikiOptions {
  /** Map of theme aliases to Shiki theme names. */
  themes?: Record<string, string>;
  /** Initial theme alias to use. Must exist in `themes`. */
  defaultColor?: string;
  /** Regex engine used by shiki. */
  engine?: "javascript" | "oniguruma";
}

export interface TypstShikiHighlighting {
  extension: Extension;
  getTheme: (name?: string, view?: EditorView) => Extension;
  /** Highlight a code string to HTML. Falls back to Typst highlighting for unknown languages. */
  highlightCode: (code: string, language: string) => string;
}

export async function createTypstShikiHighlighting(
  options: TypstShikiOptions = {},
): Promise<TypstShikiHighlighting> {
  const {
    createHighlighter,
    createJavaScriptRegexEngine,
    createOnigurumaEngine,
  } = await import("shiki");
  const { default: shiki } = await import("codemirror-shiki");

  const themes = options.themes ?? {
    light: "github-light",
    dark: "github-dark",
  };

  const fallbackAlias = Object.keys(themes)[0] ?? "dark";
  const resolveTheme = (alias?: string): string => {
    if (alias && themes[alias]) return themes[alias];
    return (
      themes[options.defaultColor ?? (themes.dark ? "dark" : fallbackAlias)] ??
      themes[fallbackAlias] ??
      "github-dark"
    );
  };

  const uniqueThemes = Array.from(new Set(Object.values(themes)));

  const engine =
    options.engine === "oniguruma"
      ? createOnigurumaEngine(import("shiki/wasm"))
      : createJavaScriptRegexEngine();

  // Keep as a promise — codemirror-shiki resolves it asynchronously to avoid
  // re-entrant EditorView.update calls during construction.
  const highlighterPromise = createHighlighter({
    langs: ["typst"],
    themes: uniqueThemes,
    engine,
  });
  const highlighter = await highlighterPromise;

  const defaultTheme = resolveTheme(options.defaultColor);

  const buildExtension = (theme: string): Extension =>
    shiki({ highlighter: highlighterPromise, language: "typst", theme });

  const highlightCode = (code: string, language: string): string => {
    const lang = highlighter.getLoadedLanguages().includes(language) ? language : "typst";
    return highlighter.codeToHtml(code, { lang, theme: defaultTheme });
  };

  return {
    extension: buildExtension(defaultTheme),
    getTheme: (name?: string) => buildExtension(resolveTheme(name)),
    highlightCode,
  };
}

export async function createTypstShikiExtension(
  options: TypstShikiOptions = {},
): Promise<Extension> {
  return (await createTypstShikiHighlighting(options)).extension;
}
