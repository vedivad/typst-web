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
}

type ThemeResolver = (alias?: string) => string;

export class TypstShiki {
  private constructor(
    public readonly extension: Extension,
    private readonly resolveTheme: ThemeResolver,
    private readonly buildExtension: (theme: string) => Extension,
  ) {}

  static async create(options: TypstShikiOptions = {}): Promise<TypstShiki> {
    const { createHighlighter, createJavaScriptRegexEngine, createOnigurumaEngine } = await import("shiki");
    const { default: shiki } = await import("codemirror-shiki");

    const themes = options.themes ?? {
      light: "github-light",
      dark: "github-dark",
    };

    const aliases = Object.keys(themes);
    const fallbackAlias = aliases[0] ?? "dark";
    const resolveTheme: ThemeResolver = (alias?: string): string => {
      if (alias && themes[alias]) return themes[alias];
      return themes[options.defaultColor ?? (themes.dark ? "dark" : fallbackAlias)] ?? themes[fallbackAlias] ?? "github-dark";
    };

    const uniqueThemes = Array.from(new Set(Object.values(themes)));

    const engine =
      options.engine === "oniguruma"
        ? createOnigurumaEngine(import("shiki/wasm"))
        : createJavaScriptRegexEngine();

    const highlighter = createHighlighter({
      langs: ["typst"],
      themes: uniqueThemes,
      engine,
    });

    const buildExtension = (theme: string): Extension =>
      shiki({
        highlighter,
        language: "typst",
        theme,
      });

    return new TypstShiki(buildExtension(resolveTheme(options.defaultColor)), resolveTheme, buildExtension);
  }

  getTheme(name?: string, _view?: EditorView): Extension {
    return this.buildExtension(this.resolveTheme(name));
  }
}

/**
 * Create a CodeMirror extension that highlights Typst using Shiki's TextMate grammar.
 */
export async function createTypstShikiHighlighting(
  options: TypstShikiOptions = {},
): Promise<TypstShikiHighlighting> {
  const instance = await TypstShiki.create(options);

  return {
    extension: instance.extension,
    getTheme: instance.getTheme.bind(instance),
  };
}

/**
 * Convenience helper when only the extension is needed.
 */
export async function createTypstShikiExtension(options: TypstShikiOptions = {}): Promise<Extension> {
  const instance = await TypstShiki.create(options);
  return instance.extension;
}