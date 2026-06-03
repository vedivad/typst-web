import { describe, expect, it } from "vitest";
import { renderHoverMarkdown } from "../hover-markdown.js";

describe("renderHoverMarkdown", () => {
  it("renders markdown links as anchors", () => {
    const html = renderHoverMarkdown(
      "[Open docs](https://typst.app/docs/reference/layout/align/)",
    );

    expect(html).toContain(
      'href="https://typst.app/docs/reference/layout/align/"',
    );
    expect(html).toContain('target="_blank"');
  });

  it("escapes raw HTML input", () => {
    const html = renderHoverMarkdown('<script>alert("x")</script>');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses custom highlighter for fenced code blocks and tags it with cm-typst-hover-code", () => {
    const html = renderHoverMarkdown(
      "```typst\n#set page(height: 120pt)\n```",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    expect(html).toContain(
      '<pre class="cm-typst-hover-code" data-lang="typst">#set page(height: 120pt)',
    );
  });

  it("strips shiki's inline background-color on highlighted blocks", () => {
    const html = renderHoverMarkdown(
      "```typst\n#set page(height: 120pt)\n```",
      (code) =>
        `<pre class="shiki" style="background-color:#fff;color:#24292e">${code}</pre>`,
    );

    expect(html).not.toContain("background-color:#fff");
    expect(html).toContain('style="color:#24292e"');
    expect(html).toContain('class="cm-typst-hover-code shiki"');
  });

  it("does not wrap highlighted output in markdown-it's <pre><code> shell", () => {
    const html = renderHoverMarkdown(
      "Intro\n\n```typst\n#set page(height: 120pt)\n```",
      (code, language) => `<pre data-lang="${language}">${code}</pre>`,
    );

    // The highlighter output starts with `<pre`, so markdown-it should not
    // wrap it in its own `<pre><code class="language-…">…</code></pre>`.
    expect(html).not.toContain('<code class="language-typst">');
  });

  it("renders a plain prose sentence as a paragraph", () => {
    const html = renderHoverMarkdown("The total page width.");
    expect(html).toContain("<p>The total page width.</p>");
  });
});
