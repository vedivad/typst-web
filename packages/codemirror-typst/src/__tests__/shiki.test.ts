import { describe, expect, it, vi } from "vitest";
import { createTypstHighlighting, patchTypstRawBlock } from "../shiki.js";

const mocks = vi.hoisted(() => {
  const highlighter = {
    getLoadedLanguages: vi.fn(() => ["typst", "javascript"]),
    codeToHtml: vi.fn(
      (code: string, options: { lang: string; theme: string }) =>
        `<pre data-lang="${options.lang}" data-theme="${options.theme}">${code}</pre>`,
    ),
  };
  const typstGrammar = [
    {
      name: "typst",
      scopeName: "source.typst",
      repository: {
        markup: {
          patterns: [
            {
              name: "markup.raw.block.typst",
              begin: "`{3,}",
              end: "\\x00",
              captures: { "0": { name: "punctuation.definition.raw.typst" } },
            },
          ],
        },
      },
    },
  ];
  return {
    highlighter,
    typstGrammar,
    synchronousHighlightEffect: {
      of: vi.fn(() => ({ kind: "sync-highlight" })),
    },
    shikiExtension: vi.fn((options: { theme: string }) => ({
      kind: "shiki-extension",
      theme: options.theme,
    })),
  };
});

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue(mocks.highlighter),
  createJavaScriptRegexEngine: vi.fn(() => ({ kind: "javascript-engine" })),
  createOnigurumaEngine: vi.fn(() => ({ kind: "oniguruma-engine" })),
  bundledLanguages: {
    typst: vi.fn().mockResolvedValue({ default: mocks.typstGrammar }),
  },
}));

vi.mock("codemirror-shiki", () => ({
  default: mocks.shikiExtension,
  synchronousHighlightEffect: mocks.synchronousHighlightEffect,
}));

describe("createTypstHighlighting", () => {
  it("updates the current theme and dispatches a compartment reconfigure", async () => {
    const highlighting = await createTypstHighlighting({
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      theme: "light",
    });
    const view = { dispatch: vi.fn() };

    expect(highlighting.theme).toBe("light");
    highlighting.setTheme(view as any, "dark");

    expect(highlighting.theme).toBe("dark");
    expect(view.dispatch).toHaveBeenCalledWith({
      effects: [expect.any(Object), { kind: "sync-highlight" }],
    });
    expect(mocks.synchronousHighlightEffect.of).toHaveBeenCalledWith(null);
    expect(mocks.shikiExtension).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "github-dark-dimmed" }),
    );
  });

  it("uses the latest theme when highlighting hover code", async () => {
    const highlighting = await createTypstHighlighting({
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      theme: "light",
    });

    highlighting.highlightCode("#let x = 1", "typst");
    expect(mocks.highlighter.codeToHtml).toHaveBeenLastCalledWith(
      "#let x = 1",
      { lang: "typst", theme: "github-light" },
    );

    highlighting.setTheme({ dispatch: vi.fn() } as any, "dark");
    highlighting.highlightCode("const x = 1", "javascript");

    expect(mocks.highlighter.codeToHtml).toHaveBeenLastCalledWith(
      "const x = 1",
      { lang: "javascript", theme: "github-dark-dimmed" },
    );
  });

  it("accepts custom theme aliases", async () => {
    const highlighting = await createTypstHighlighting({
      themes: { sepia: "github-light", night: "github-dark" },
      theme: "sepia",
    });

    expect(highlighting.theme).toBe("sepia");
    highlighting.highlightCode("#let x = 1", "typst");

    expect(mocks.highlighter.codeToHtml).toHaveBeenLastCalledWith(
      "#let x = 1",
      { lang: "typst", theme: "github-light" },
    );
  });
});

describe("patchTypstRawBlock", () => {
  function rawBlockRule(grammar: any) {
    return grammar.repository.markup.patterns.find(
      (p: { name?: string }) => p.name === "markup.raw.block.typst",
    );
  }

  it("rewrites the never-closing end into a backtick backreference", () => {
    const grammar = structuredClone(mocks.typstGrammar)[0] as any;
    expect(rawBlockRule(grammar).end).toBe("\\x00");

    patchTypstRawBlock(grammar);

    const raw = rawBlockRule(grammar);
    expect(raw.begin).toBe("(`{3,})");
    expect(raw.end).toBe("\\1");
    expect(raw.captures).toBeUndefined();
    expect(raw.beginCaptures["1"].name).toBe(
      "punctuation.definition.raw.typst",
    );
    expect(raw.endCaptures["1"].name).toBe("punctuation.definition.raw.typst");
  });

  it("leaves an already-correct grammar untouched", () => {
    const grammar = structuredClone(mocks.typstGrammar)[0] as any;
    rawBlockRule(grammar).end = "\\1";

    patchTypstRawBlock(grammar);

    expect(rawBlockRule(grammar).end).toBe("\\1");
    expect(rawBlockRule(grammar).begin).toBe("`{3,}");
  });
});
