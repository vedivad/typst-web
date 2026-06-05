//! The compiled document: producing it (`compile_project`) and consuming it
//! (render to SVG, export to PDF). Both read the document the world caches.
//!
//! This is plain Rust (no `#[wasm_bindgen]`), so it is the host-testable core
//! that `cargo test` exercises directly.

use serde::Serialize;
use tsify::Tsify;
use typst::compile;
use typst::layout::PagedDocument;
use typst_pdf::{PdfOptions, pdf};
use typst_svg::svg;

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

/// Render a single page of the cached document to SVG, or `None` if there is no
/// cached document or the index is out of range.
pub fn render_page(world: &ProjectWorld, index: usize) -> Option<String> {
    world
        .with_document(|doc| doc.pages.get(index).map(svg))
        .flatten()
}

/// Render pages `[start, end)` of the cached document to SVG, clamping `end` to
/// the page count. Empty if there is no document or the range is empty.
pub fn render_pages(world: &ProjectWorld, start: usize, end: usize) -> Vec<String> {
    world
        .with_document(|doc| {
            let end = end.min(doc.pages.len());
            if start >= end {
                return Vec::new();
            }
            doc.pages[start..end].iter().map(svg).collect()
        })
        .unwrap_or_default()
}

/// Export the cached document to PDF bytes, or `None` if there is no cached
/// document or PDF generation fails. PDF export of an already-laid-out document
/// effectively never fails, so an error maps to `None` rather than being
/// surfaced, keeping the boundary as simple as `render_page`.
pub fn export_pdf(world: &ProjectWorld) -> Option<Vec<u8>> {
    world
        .with_document(|doc| pdf(doc, &PdfOptions::default()).ok())
        .flatten()
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
    fn renders_individual_pages_and_a_range() {
        let world = world_with("main.typ", &[("main.typ", "= A\n#pagebreak()\n= B")]);
        let result = compile_project(&world);

        assert_eq!(result.pages.len(), 2, "pagebreak yields two pages");
        assert!(result.pages.iter().all(|p| p.width > 0.0 && p.height > 0.0));

        assert!(render_page(&world, 0).is_some_and(|s| s.contains("<svg")));
        assert!(render_page(&world, 1).is_some());
        assert!(render_page(&world, 5).is_none(), "out of range");

        assert_eq!(render_pages(&world, 0, 2).len(), 2);
        assert_eq!(
            render_pages(&world, 0, 99).len(),
            2,
            "end clamps to page count"
        );
        assert!(render_pages(&world, 2, 2).is_empty(), "empty range");
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
    fn no_document_renders_nothing() {
        let world = ProjectWorld::new();
        assert!(render_page(&world, 0).is_none());
        assert!(render_pages(&world, 0, 5).is_empty());
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

    #[test]
    fn exports_pdf_after_compile() {
        let world = world_with("main.typ", &[("main.typ", "= Hello")]);
        assert!(export_pdf(&world).is_none(), "no document before compile");
        compile_project(&world);
        let bytes = export_pdf(&world).expect("pdf bytes after compile");
        assert!(bytes.starts_with(b"%PDF-"), "valid PDF header");
    }
}
