//! Editor intelligence: completions and hover, via Typst's own `typst-ide`.
//!
//! `ProjectWorld` implements `typst_ide::IdeWorld` (in `world.rs`), which these
//! functions require. Conversions from the `typst_ide` types are context-free,
//! so they are `From` impls (unlike diagnostics, which need `&World`).
//!
//! The compiled `PagedDocument` is intentionally NOT passed (we use `None`):
//! that only adds label completions and reference tooltips at the cost of a
//! compile per call. Wiring a cached document is a Milestone 7 (perf) follow-up.
//! Cursors are UTF-8 byte offsets into the file, like the diagnostic offsets.

use serde::Serialize;
use tsify::Tsify;
use typst::World;
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
}
