//! Editor intelligence: completions, hover, and click resolution, via Typst's
//! own `typst-ide`.
//!
//! `ProjectWorld` implements `typst_ide::IdeWorld` (in `world.rs`), which these
//! functions require. Conversions from the `typst_ide` types are context-free,
//! so they are `From` impls (unlike diagnostics, which need `&World`).
//!
//! Completion/hover intentionally do NOT pass the compiled `PagedDocument` (we
//! use `None`): that only adds label completions and reference tooltips at the
//! cost of a compile per call. Wiring a cached document is a Milestone 7 (perf)
//! follow-up. `click_jump` does read the cached document (via `with_document`),
//! since resolving a click needs the laid-out frame. Cursors are UTF-8 byte
//! offsets into the file, like the diagnostic offsets.

use serde::Serialize;
use tsify::Tsify;
use typst::World;
use typst::layout::{Abs, Point};
use typst::syntax::Side;
use typst_ide::{
    Completion as IdeCompletion, CompletionKind as IdeCompletionKind, Tooltip, autocomplete,
    tooltip,
};

use crate::vfs::file_id;
use crate::world::ProjectWorld;

/// The kind of thing a completion inserts.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum CompletionKind {
    Syntax,
    Func,
    Type,
    Param,
    Constant,
    Path,
    Package,
    Label,
    Font,
    Symbol,
}

/// A single completion candidate.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[tsify(into_wasm_abi)]
pub struct Completion {
    pub kind: CompletionKind,
    pub label: String,
    /// Insertion text, possibly with snippet placeholders like `${body}`.
    /// Falls back to `label` when `None`.
    pub apply: Option<String>,
    pub detail: Option<String>,
}

/// The completions at a cursor, plus where the replacement starts.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[tsify(into_wasm_abi)]
pub struct CompletionResponse {
    /// Byte offset where the replacement begins; the editor replaces `from..cursor`.
    pub from: usize,
    pub completions: Vec<Completion>,
}

/// Whether a hover tooltip is prose or Typst code.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum HoverKind {
    Text,
    Code,
}

/// A hover tooltip.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[tsify(into_wasm_abi)]
pub struct Hover {
    pub kind: HoverKind,
    pub value: String,
}

/// Where a click in the preview should take the user, resolved by Typst from the
/// laid-out frame under the cursor (`typst_ide::jump_from_click`).
///
/// - `Source`, the click was over text; jump the editor to that 1-based source
///   location (file/line/column, matching `Diagnostic`'s `Location`).
/// - `Position`, the click was over an internal link (e.g. an `#outline()`
///   entry); scroll the preview to that page and point (in points).
/// - `Url`, the click was over an external link.
#[derive(Serialize, Tsify, Clone, PartialEq, Debug)]
#[tsify(into_wasm_abi)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClickJump {
    Source {
        file: String,
        line: usize,
        column: usize,
    },
    Position {
        page: usize,
        x: f64,
        y: f64,
    },
    Url {
        url: String,
    },
}

/// Where a source cursor renders in the laid-out document, from
/// `typst_ide::jump_from_cursor`: a 0-based `page` and a `point` (in points). The
/// reverse of `ClickJump::Position`, for scrolling the preview to follow the
/// editor cursor.
#[derive(Serialize, Tsify, Clone, PartialEq, Debug)]
#[tsify(into_wasm_abi)]
pub struct CursorJump {
    pub page: usize,
    pub x: f64,
    pub y: f64,
}

/// Completions at `cursor` (a byte offset) in `path`. `explicit` is `true` when
/// the user explicitly requested completion (e.g. Ctrl-Space).
pub fn complete(
    world: &ProjectWorld,
    path: &str,
    cursor: usize,
    explicit: bool,
) -> Option<CompletionResponse> {
    let source = world.source(file_id(path)).ok()?;
    let (from, completions) = autocomplete(world, None, &source, cursor, explicit)?;
    Some(CompletionResponse {
        from,
        completions: completions.iter().map(Completion::from).collect(),
    })
}

/// Hover tooltip at `cursor` (a byte offset) in `path`.
pub fn hover(world: &ProjectWorld, path: &str, cursor: usize) -> Option<Hover> {
    let source = world.source(file_id(path)).ok()?;
    let tip = tooltip(world, None, &source, cursor, Side::Before)?;
    Some(Hover::from(tip))
}

/// Resolve a click at `(x, y)` points on page `index` of the cached document into
/// where it should take the user (source text, an internal link target, or a
/// URL), or `None` if there is no cached document, the page is out of range, or
/// the click hit nothing actionable.
///
/// This is what the SVG can't express on its own: typst's single-page export
/// emits text without source spans and internal links without a destination.
/// `jump_from_click` recovers both from the laid-out frame.
pub fn click_jump(world: &ProjectWorld, index: usize, x: f64, y: f64) -> Option<ClickJump> {
    let click = Point::new(Abs::pt(x), Abs::pt(y));
    world
        .with_document(|document| {
            let frame = &document.pages.get(index)?.frame;
            Some(
                match typst_ide::jump_from_click(world, document, frame, click)? {
                    typst_ide::Jump::File(id, offset) => {
                        let source = world.source(id).ok()?;
                        let (line, column) = source.lines().byte_to_line_column(offset)?;
                        ClickJump::Source {
                            // Rooted ("/main.typ") to match how the frontend keys files.
                            file: id.vpath().as_rooted_path().to_string_lossy().into_owned(),
                            line: line + 1,
                            column: column + 1,
                        }
                    }
                    typst_ide::Jump::Position(pos) => ClickJump::Position {
                        page: pos.page.get().saturating_sub(1),
                        x: pos.point.x.to_pt(),
                        y: pos.point.y.to_pt(),
                    },
                    typst_ide::Jump::Url(url) => ClickJump::Url {
                        url: url.to_string(),
                    },
                },
            )
        })
        .flatten()
}

/// Resolve a `cursor` (byte offset) in `path` to where it renders in the cached
/// document: a 0-based page and point (in points), or `None` if there is no
/// cached document, the file is absent, or the cursor maps onto no text.
pub fn jump_from_cursor(world: &ProjectWorld, path: &str, cursor: usize) -> Option<CursorJump> {
    let source = world.source(file_id(path)).ok()?;
    world
        .with_document(|document| {
            let pos = typst_ide::jump_from_cursor(document, &source, cursor)
                .into_iter()
                .next()?;
            Some(CursorJump {
                page: pos.page.get().saturating_sub(1),
                x: pos.point.x.to_pt(),
                y: pos.point.y.to_pt(),
            })
        })
        .flatten()
}

impl From<&IdeCompletion> for Completion {
    fn from(completion: &IdeCompletion) -> Self {
        Completion {
            kind: (&completion.kind).into(),
            label: completion.label.to_string(),
            apply: completion.apply.as_ref().map(|text| text.to_string()),
            detail: completion.detail.as_ref().map(|text| text.to_string()),
        }
    }
}

impl From<&IdeCompletionKind> for CompletionKind {
    fn from(kind: &IdeCompletionKind) -> Self {
        match kind {
            IdeCompletionKind::Syntax => CompletionKind::Syntax,
            IdeCompletionKind::Func => CompletionKind::Func,
            IdeCompletionKind::Type => CompletionKind::Type,
            IdeCompletionKind::Param => CompletionKind::Param,
            IdeCompletionKind::Constant => CompletionKind::Constant,
            IdeCompletionKind::Path => CompletionKind::Path,
            IdeCompletionKind::Package => CompletionKind::Package,
            IdeCompletionKind::Label => CompletionKind::Label,
            IdeCompletionKind::Font => CompletionKind::Font,
            // The glyph itself is carried in `label`/`apply`, so drop the payload.
            IdeCompletionKind::Symbol(_) => CompletionKind::Symbol,
        }
    }
}

impl From<Tooltip> for Hover {
    fn from(tip: Tooltip) -> Self {
        match tip {
            Tooltip::Text(value) => Hover {
                kind: HoverKind::Text,
                value: value.to_string(),
            },
            Tooltip::Code(value) => Hover {
                kind: HoverKind::Code,
                value: value.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::compile_project;

    fn world_with(main: &str, files: &[(&str, &str)]) -> ProjectWorld {
        let mut world = ProjectWorld::new();
        for (path, text) in files {
            world.set_file(path, text.as_bytes().to_vec());
        }
        world.set_entry(main);
        world
    }

    #[test]
    fn completes_identifier_prefix() {
        let world = world_with("main.typ", &[("main.typ", "#i")]);
        let response = complete(&world, "main.typ", 2, true).expect("completions");

        assert!(response.from <= 2);
        assert!(
            response.completions.iter().any(|c| c.label == "int"),
            "expected `int` among labels: {:?}",
            response
                .completions
                .iter()
                .map(|c| &c.label)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn hover_on_length_literal_returns_tooltip() {
        let world = world_with("main.typ", &[("main.typ", "#1pt")]);
        // cursor inside the `1pt` length literal.
        assert!(hover(&world, "main.typ", 3).is_some());
    }

    #[test]
    fn unknown_file_has_no_completions() {
        let world = world_with("main.typ", &[("main.typ", "#i")]);
        assert!(complete(&world, "nope.typ", 0, true).is_none());
    }

    #[test]
    fn click_jumps_to_link_and_source() {
        let src = "#outline()\n#pagebreak()\n\n= Test Page 1\nbody text\n\n#pagebreak()\n\n= Test Page 2\nbody";
        let world = world_with("main.typ", &[("main.typ", src)]);
        compile_project(&world);

        // Clicking the first outline entry (page 0) is an internal jump forward to
        // the `= Test Page 1` heading on page 2 (index 1).
        match click_jump(&world, 0, 100.0, 92.0) {
            Some(ClickJump::Position { page, .. }) => assert_eq!(page, 1),
            other => panic!("expected a Position jump, got {other:?}"),
        }

        // Empty space resolves to nothing actionable.
        assert!(click_jump(&world, 0, 300.0, 500.0).is_none());

        // Clicking the heading text on page 2 jumps back to its source. Scan the
        // heading band for a glyph, since exact hit points are layout-dependent.
        let mut source = None;
        'scan: for xi in (70..220).step_by(4) {
            for yi in [74.0, 78.0, 82.0, 86.0] {
                if let Some(jump @ ClickJump::Source { .. }) =
                    click_jump(&world, 1, f64::from(xi), yi)
                {
                    source = Some(jump);
                    break 'scan;
                }
            }
        }
        match source {
            Some(ClickJump::Source { file, line, .. }) => {
                assert_eq!(file, "/main.typ");
                assert_eq!(line, 4, "`= Test Page 1` is on line 4 of the source");
            }
            other => panic!("expected a Source jump on the heading, got {other:?}"),
        }
    }

    #[test]
    fn jumps_from_cursor_to_its_rendered_page() {
        let src = "#outline()\n#pagebreak()\n\n= Test Page 1\nbody text\n\n#pagebreak()\n\n= Test Page 2\nbody";
        let world = world_with("main.typ", &[("main.typ", src)]);
        compile_project(&world);

        // A cursor in the `body text` on page 2 (index 1) maps to where it renders.
        // (Body text, unlike a heading, isn't duplicated into the outline.)
        let cursor = src.find("body text").expect("body text") + 2;
        match jump_from_cursor(&world, "main.typ", cursor) {
            Some(CursorJump { page, .. }) => assert_eq!(page, 1),
            other => panic!("expected a cursor jump, got {other:?}"),
        }

        // A cursor that is not over rendered text (inside the `#outline()` call)
        // maps nowhere.
        assert!(jump_from_cursor(&world, "main.typ", 3).is_none());
    }
}
