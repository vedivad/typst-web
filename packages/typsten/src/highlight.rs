//! Syntax highlighting via Typst's own `typst-syntax`.
//!
//! Reuses the exact highlighter the engine uses (`typst::syntax::highlight`),
//! so there is no separate grammar to drift from the real parser. Two shapes,
//! both stateless (they parse the passed text directly, never the VFS, so they
//! serve the live editor buffer and one-off hover snippets alike):
//!
//! - [`highlight_spans`] returns tagged byte ranges overlapping a window, for
//!   the editor to apply as decorations.
//! - [`highlight_html_string`] returns ready HTML (Typst's own `highlight_html`)
//!   for static contexts like hover tooltips.

use serde::Serialize;
use tsify::Tsify;
use typst::syntax::{LinkedNode, Tag, highlight, highlight_html, parse, parse_code};

/// A highlighted source span: a half-open byte range and its CSS class.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[tsify(into_wasm_abi)]
pub struct HlSpan {
    pub from: u32,
    pub to: u32,
    /// Typst's own stable highlight class, e.g. `typ-key`, `typ-func`, `typ-str`
    /// (see `Tag::css_class`). The editor uses it verbatim as the decoration class.
    pub tag: String,
}

/// Highlight `text`, returning the spans whose byte range overlaps `[from, to)`,
/// in source order. Pass `0..text.len()` to highlight the whole string.
///
/// Spans may nest (a `typ-strong` run containing a `typ-func` leaf), mirroring
/// `highlight_html`; CodeMirror applies overlapping mark classes correctly.
pub fn highlight_spans(text: &str, from: usize, to: usize) -> Vec<HlSpan> {
    let root = parse(text);
    let mut spans = Vec::new();
    collect(&LinkedNode::new(&root), from, to, &mut spans);
    spans
}

/// Highlight a Typst code snippet to nested `<span class="typ-*">` HTML
/// (html-escaped, wrapped in `<code>`) via Typst's own `highlight_html`. For
/// static views like hover tooltips, whose `Code` value is a code-mode snippet
/// (a value repr, a length conversion), so it is parsed in code mode, not
/// markup mode, or numbers/operators would not be tokenized and render plain.
pub fn highlight_html_string(text: &str) -> String {
    highlight_html(&parse_code(text))
}

/// Walk the tree, emitting a span for each tagged node overlapping the window
/// and recursing so nested tags survive.
fn collect(node: &LinkedNode, from: usize, to: usize, out: &mut Vec<HlSpan>) {
    let range = node.range();
    // A child's range is contained in its parent's, so a subtree that does not
    // overlap the window contributes nothing and can be pruned whole.
    if range.start >= to || range.end <= from {
        return;
    }
    // `Error` tokens are left to the diagnostics layer (the lint squiggles),
    // matching `highlight_html`, which skips them too.
    if let Some(tag) = highlight(node)
        && tag != Tag::Error
    {
        out.push(HlSpan {
            from: range.start as u32,
            to: range.end as u32,
            tag: tag.css_class().to_string(),
        });
    }
    for child in node.children() {
        collect(&child, from, to, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(text: &str) -> Vec<String> {
        highlight_spans(text, 0, text.len())
            .into_iter()
            .map(|s| s.tag)
            .collect()
    }

    #[test]
    fn tags_code_keyword_and_number() {
        let tags = tags("#let x = 1");
        assert!(tags.iter().any(|t| t == "typ-key"), "{tags:?}");
        assert!(tags.iter().any(|t| t == "typ-num"), "{tags:?}");
    }

    #[test]
    fn tags_heading_and_string() {
        assert!(tags("= Title").iter().any(|t| t == "typ-heading"));
        assert!(tags("#\"hi\"").iter().any(|t| t == "typ-str"));
    }

    #[test]
    fn nested_tags_are_emitted() {
        // A function call inside strong markup: both the outer strong and the
        // inner function name should be tagged (overlapping spans).
        let tags = tags("*#emph[x]*");
        assert!(tags.iter().any(|t| t == "typ-strong"), "{tags:?}");
        assert!(tags.iter().any(|t| t == "typ-func"), "{tags:?}");
    }

    #[test]
    fn window_prunes_spans_outside_the_viewport() {
        let text = "= A\n\n#let x = 1";
        // Window over the heading line only.
        let spans = highlight_spans(text, 0, 3);
        assert!(spans.iter().any(|s| s.tag == "typ-heading"));
        // The later `#let` keyword sits outside the window and is not emitted.
        assert!(spans.iter().all(|s| s.from < 3));
        assert!(!spans.iter().any(|s| s.tag == "typ-key"));
    }

    #[test]
    fn empty_text_has_no_spans() {
        assert!(highlight_spans("", 0, 0).is_empty());
    }

    #[test]
    fn html_highlights_a_code_snippet() {
        // A hover `Code` value is code-mode Typst (e.g. a length conversion or a
        // value repr), so numbers/operators must be tokenized, not left plain.
        let html = highlight_html_string("12pt = 4.23mm");
        assert!(html.starts_with("<code>"), "{html}");
        assert!(html.contains("class=\"typ-num\""), "{html}");
    }
}
