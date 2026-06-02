import {
  type BundledLanguage,
  createHighlighter,
  createJavaScriptRegexEngine,
} from "shiki";
import { describe, expect, it } from "vitest";
import { patchTypstRawBlock } from "../shiki.js";

// Exercises the real bundled Typst grammar (no shiki mock here) to prove the
// raw-block patch fixes highlighting bleeding past a fenced code block.
async function tokenizeTypst(code: string, patch: boolean) {
  const { bundledLanguages } = await import("shiki");
  const [grammar] = structuredClone(
    (await bundledLanguages["typst" as BundledLanguage]()).default,
  );
  if (patch && grammar) patchTypstRawBlock(grammar);

  const highlighter = await createHighlighter({
    langs: [grammar!],
    themes: ["github-dark"],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter.codeToTokens(code, {
    lang: "typst",
    theme: "github-dark",
    includeExplanation: "scopeName",
  }).tokens;
}

const SAMPLE = [
  "= Test",
  "Hello",
  "",
  "```js",
  'console.write("ja");',
  "```",
  "",
  "= Heading",
].join("\n");

function scopesOf(
  tokens: Awaited<ReturnType<typeof tokenizeTypst>>,
  line: number,
) {
  return (tokens[line] ?? []).flatMap((t) =>
    (t.explanation ?? []).flatMap((e) => e.scopes.map((s) => s.scopeName)),
  );
}

describe("typst raw-block highlighting (real grammar)", () => {
  it("regression: the unpatched grammar bleeds raw scope past the closing fence", async () => {
    const tokens = await tokenizeTypst(SAMPLE, false);
    // The trailing heading is wrongly still inside the raw block.
    expect(scopesOf(tokens, 7)).toContain("markup.raw.block.typst");
    expect(scopesOf(tokens, 7)).not.toContain("entity.name.section.typst");
  });

  it("patched: the closing fence ends the block so later markup highlights again", async () => {
    const tokens = await tokenizeTypst(SAMPLE, true);
    expect(scopesOf(tokens, 7)).toContain("entity.name.section.typst");
    expect(scopesOf(tokens, 7)).not.toContain("markup.raw.block.typst");
  });
});
