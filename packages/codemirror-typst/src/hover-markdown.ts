import MarkdownIt from "markdown-it";

export type CodeHighlighter = (code: string, language: string) => string;

/**
 * Strip trailing newlines so shiki doesn't render an empty `<span class="line">`
 * at the end (markdown-it preserves the closing newline of a fenced block).
 */
function stripTrailingNewlines(code: string): string {
  return code.replace(/\n+$/, "");
}

/**
 * Tag shiki's outer `<pre>` with `cm-typst-hover-code` so consumers have a
 * single, stable hook regardless of how the code reached the highlighter.
 * Returning a string that starts with `<pre` also prevents markdown-it from
 * wrapping the result in its own `<pre><code class="language-…">…</code></pre>`
 * shell, which would otherwise nest two `<pre>` elements.
 *
 * Also strips shiki's inline `background-color` so consumers can theme the
 * code-block background via CSS without needing `!important` to beat the
 * inline style. Foreground `color` is preserved so syntax-highlighting
 * default colors still apply.
 */
function tagShikiHoverCode(html: string): string {
  // Remove just the background-color declaration from the inline style.
  // Trailing semicolon is optional; collapse any leftover empty style="".
  const withoutBg = html
    .replace(/background-color\s*:\s*[^;"]+;?/, "")
    .replace(/\sstyle=""/, "");
  if (withoutBg.startsWith('<pre class="')) {
    return withoutBg.replace(
      /^<pre class="/,
      '<pre class="cm-typst-hover-code ',
    );
  }
  if (withoutBg.startsWith("<pre")) {
    return withoutBg.replace(/^<pre/, '<pre class="cm-typst-hover-code"');
  }
  // Highlighter returned something unexpected; wrap defensively so the
  // result still starts with `<pre` and bypasses markdown-it's wrapping.
  return `<pre class="cm-typst-hover-code">${withoutBg}</pre>`;
}

function createParser(highlightCode?: CodeHighlighter): MarkdownIt {
  const mdParser: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      const language = lang.trim().toLowerCase();
      const normalizedCode = stripTrailingNewlines(code);
      if (highlightCode && language) {
        return tagShikiHoverCode(highlightCode(normalizedCode, language));
      }

      const escapedCode = mdParser.utils.escapeHtml(normalizedCode);
      const escapedLang = language
        ? ` class="language-${mdParser.utils.escapeHtml(language)}"`
        : "";
      return `<pre class="cm-typst-hover-pre"><code${escapedLang}>${escapedCode}</code></pre>`;
    },
  });

  const defaultLinkOpen =
    mdParser.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) =>
      self.renderToken(tokens, idx, options));

  mdParser.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return mdParser;
}

/**
 * Render a hover tooltip's markdown to HTML. typsten's `Hover` is only ever a
 * plain prose sentence or a single fenced Typst code block (see `hover.ts`), so
 * this is a straight markdown-it render with shiki highlighting - no document
 * structuring is needed (that was for tinymist's multi-section hover output).
 *
 * Security: raw HTML is disabled (`html: false`) so hover docs cannot inject
 * arbitrary markup into the tooltip.
 */
export function renderHoverMarkdown(
  md: string,
  highlightCode?: CodeHighlighter,
): string {
  return createParser(highlightCode).render(md);
}
