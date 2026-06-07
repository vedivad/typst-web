//! Producing the compiled document: run the engine, surface diagnostics, cache
//! the laid-out `PagedDocument` on the world, and report page metadata.
//! Consuming it (render to SVG, export to PDF) lives in `render`.
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

    let pages = page_sizes(world)
        .into_iter()
        .map(|(width, height)| PageInfo { width, height })
        .collect();

    CompileResult { pages, diagnostics }
}

/// Width and height (in points) of every page of the cached document.
fn page_sizes(world: &ProjectWorld) -> Vec<(f64, f64)> {
    world
        .with_document(|doc| {
            doc.pages
                .iter()
                .map(|page| (page.frame.width().to_pt(), page.frame.height().to_pt()))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;
    use crate::render::render_page;

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
            render_page(&world, 0).is_some_and(|svg| svg.contains("<svg")),
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
        assert!(render_page(&world, 0).is_none());
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
            render_page(&world, 0).is_some(),
            "last-good page still renders"
        );
    }

    #[test]
    fn edit_is_reflected() {
        let mut world = world_with("main.typ", &[("main.typ", "= Alpha")]);
        compile_project(&world);
        let a = render_page(&world, 0).expect("page a");
        world.set_file("main.typ", b"= Beta".to_vec());
        compile_project(&world);
        let b = render_page(&world, 0).expect("page b");
        assert_ne!(a, b, "an edit should change the rendered output");
    }

    #[test]
    fn unchanged_recompile_is_stable() {
        let world = world_with("main.typ", &[("main.typ", "= Hello")]);
        let r1 = compile_project(&world);
        let first = render_page(&world, 0).expect("page");
        let r2 = compile_project(&world);
        let second = render_page(&world, 0).expect("page");
        assert_eq!(first, second, "unchanged recompile renders identically");
        assert!(r1.diagnostics.is_empty() && r2.diagnostics.is_empty());
    }
}
