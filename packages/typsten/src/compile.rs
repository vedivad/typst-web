//! Compilation orchestration: run the engine and assemble a typed result.
//!
//! This is plain Rust (no `#[wasm_bindgen]`), so it is the host-testable core
//! that `cargo test` exercises directly.

use serde::Serialize;
use tsify::Tsify;
use typst::compile;
use typst::layout::PagedDocument;

use crate::diagnostics::Diagnostic;
use crate::world::ProjectWorld;

/// The width and height of a rendered page, in points.
#[derive(Serialize, Tsify, Debug)]
pub struct PageInfo {
    pub width: f64,
    pub height: f64,
}

/// The outcome of a compile: one `PageInfo` per renderable page plus all
/// diagnostics. `compile()` does NOT render, pages are drawn on demand via
/// `render_page`/`render_pages`. Diagnostics are DATA, not errors (the editor
/// needs them on success as warnings and on failure as errors), so this is never
/// a `Result` and never throws. On a failed compile the `pages` describe the
/// last successful document (the last-good preview is kept), so the presence of
/// an error diagnostic means `pages` is stale.
#[derive(Serialize, Tsify, Debug)]
#[tsify(into_wasm_abi)]
pub struct CompileResult {
    pub pages: Vec<PageInfo>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Compile the project's entry file, caching the laid-out document so its pages
/// can be rendered on demand, and returning page metadata plus diagnostics. On
/// failure the previous document is kept, so the preview survives transient
/// errors.
pub fn compile_project(world: &ProjectWorld) -> CompileResult {
    let warned = compile::<PagedDocument>(world);

    let mut diagnostics: Vec<Diagnostic> = warned
        .warnings
        .iter()
        .map(|diag| Diagnostic::from_source(world, diag))
        .collect();

    match warned.output {
        // Replace the cached document; `render_page` draws from it.
        Ok(document) => world.cache_document(document),
        // Keep the last good document so the preview survives transient errors.
        Err(errors) => diagnostics.extend(
            errors
                .iter()
                .map(|diag| Diagnostic::from_source(world, diag)),
        ),
    }

    let pages = world
        .page_sizes()
        .into_iter()
        .map(|(width, height)| PageInfo { width, height })
        .collect();

    CompileResult { pages, diagnostics }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn world_with(main: &str, files: &[(&str, &str)]) -> ProjectWorld {
        let mut world = ProjectWorld::new();
        for (path, text) in files {
            world.set_file(path, text.as_bytes().to_vec());
        }
        world.set_entry(main);
        world
    }

    #[test]
    fn multi_file_project_compiles() {
        let world = world_with(
            "main.typ",
            &[
                ("main.typ", "#import \"util.typ\": greeting\n#greeting"),
                ("util.typ", "#let greeting = [hello]"),
            ],
        );
        let result = compile_project(&world);

        assert!(!result.pages.is_empty(), "expected at least one page");
        assert!(
            world.render_page(0).is_some_and(|svg| svg.contains("<svg")),
            "page 0 should render to svg"
        );
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|d| d.severity == Severity::Error),
            "unexpected errors: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn compiles_with_a_preview_package() {
        let world = world_with(
            "main.typ",
            &[
                (
                    "@preview/adder:0.1.0/typst.toml",
                    "[package]\nname = \"adder\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
                ),
                ("@preview/adder:0.1.0/lib.typ", "#let add(x, y) = x + y\n"),
                (
                    "main.typ",
                    "#import \"@preview/adder:0.1.0\": add\n#add(2, 3)",
                ),
            ],
        );
        let result = compile_project(&world);

        assert!(
            !result.pages.is_empty(),
            "package import should compile to a page, diags: {:?}",
            result.diagnostics
        );
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|d| d.severity == Severity::Error),
            "unexpected errors: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn fatal_error_reports_located_diagnostic() {
        // `nope` is an unknown variable, a fatal error with a span on the name.
        let world = world_with("main.typ", &[("main.typ", "ok\n#nope")]);
        let result = compile_project(&world);

        assert!(
            result.pages.is_empty(),
            "a first compile that fails has no renderable page"
        );
        assert!(world.render_page(0).is_none());
        let error = result
            .diagnostics
            .iter()
            .find(|d| d.severity == Severity::Error)
            .expect("a fatal error diagnostic");
        let location = error.location.as_ref().expect("a resolved location");
        assert_eq!(location.file, "main.typ");
        assert_eq!(location.line, 2, "error is on the second line");
    }

    #[test]
    fn renders_individual_pages_and_a_range() {
        let world = world_with("main.typ", &[("main.typ", "= A\n#pagebreak()\n= B")]);
        let result = compile_project(&world);

        assert_eq!(result.pages.len(), 2, "pagebreak yields two pages");
        assert!(result.pages.iter().all(|p| p.width > 0.0 && p.height > 0.0));

        assert!(world.render_page(0).is_some_and(|s| s.contains("<svg")));
        assert!(world.render_page(1).is_some());
        assert!(world.render_page(5).is_none(), "out of range");

        assert_eq!(world.render_pages(0, 2).len(), 2);
        assert_eq!(
            world.render_pages(0, 99).len(),
            2,
            "end clamps to page count"
        );
        assert!(world.render_pages(2, 2).is_empty(), "empty range");
    }

    #[test]
    fn keeps_last_good_document_on_error() {
        let mut world = world_with("main.typ", &[("main.typ", "= Hello")]);
        assert_eq!(compile_project(&world).pages.len(), 1);

        // A broken edit: errors are reported, but the preview survives.
        world.set_file("main.typ", b"#nope".to_vec());
        let result = compile_project(&world);

        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.severity == Severity::Error)
        );
        assert_eq!(result.pages.len(), 1, "last-good pages are kept");
        assert!(
            world.render_page(0).is_some(),
            "last-good page still renders"
        );
    }

    #[test]
    fn no_document_renders_nothing() {
        let world = ProjectWorld::new();
        assert!(world.render_page(0).is_none());
        assert!(world.render_pages(0, 5).is_empty());
    }
}
