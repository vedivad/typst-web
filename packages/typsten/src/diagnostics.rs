//! Typed diagnostic DTOs and the conversion from Typst's `SourceDiagnostic`.
//!
//! These cross the wasm boundary via `tsify`, so the `.d.ts` is generated. The
//! conversion needs `&dyn World` (to resolve a span to a file range and
//! line/column), so it is an associated fn rather than a `From` impl.

use serde::Serialize;
use tsify::Tsify;
use typst::World;
use typst::WorldExt;
use typst::diag::{Severity as TypstSeverity, SourceDiagnostic};
use typst::syntax::Span;

/// Whether a diagnostic is a fatal error or a non-fatal warning.
#[derive(Serialize, Tsify, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

/// Where a diagnostic points, when its span resolves to a real location.
///
/// Offsets are UTF-8 byte indices (Typst-native); `line`/`column` are 1-based
/// (editor convention). Note these are code-point based; exact UTF-16 mapping
/// for JS editors is a later refinement.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
pub struct Location {
    pub file: String,
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

/// A single compiler diagnostic, ready for an editor.
#[derive(Serialize, Tsify, Clone, PartialEq, Eq, Debug)]
#[tsify(into_wasm_abi)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub hints: Vec<String>,
    /// `None` when the span is detached or cannot be resolved.
    pub location: Option<Location>,
}

impl Diagnostic {
    /// Convert one Typst `SourceDiagnostic`, resolving its span against `world`.
    pub fn from_source(world: &dyn World, diag: &SourceDiagnostic) -> Self {
        Diagnostic {
            severity: match diag.severity {
                TypstSeverity::Error => Severity::Error,
                TypstSeverity::Warning => Severity::Warning,
            },
            message: diag.message.to_string(),
            hints: diag.hints.iter().map(|hint| hint.to_string()).collect(),
            location: Location::resolve(world, diag.span),
        }
    }
}

impl Location {
    /// Resolve a span to a file location, or `None` if it has no location.
    fn resolve(world: &dyn World, span: Span) -> Option<Location> {
        let id = span.id()?;
        let range = world.range(span)?;
        let source = world.source(id).ok()?;
        let (line, column) = source.lines().byte_to_line_column(range.start)?;
        Some(Location {
            file: id.vpath().as_rootless_path().to_string_lossy().into_owned(),
            start: range.start,
            end: range.end,
            line: line + 1,
            column: column + 1,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ProjectWorld;

    #[test]
    fn detached_span_resolves_to_no_location() {
        let world = ProjectWorld::new();
        let diag = SourceDiagnostic::warning(Span::detached(), "loose warning")
            .with_hints(["try this".into()]);
        let dto = Diagnostic::from_source(&world, &diag);

        assert_eq!(dto.severity, Severity::Warning);
        assert_eq!(dto.message, "loose warning");
        assert_eq!(dto.hints, vec!["try this".to_string()]);
        assert!(dto.location.is_none());
    }
}
