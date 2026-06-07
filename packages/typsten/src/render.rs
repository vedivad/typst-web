//! Consuming the compiled document: rendering pages to SVG and exporting to PDF.
//! The document is produced by `compile` and cached on the world; this reads it
//! back.
//!
//! Plain Rust (no `#[wasm_bindgen]`), so it is the host-testable core that
//! `cargo test` exercises directly.

use typst_pdf::{PdfOptions, pdf};
use typst_svg::svg;

use crate::world::ProjectWorld;

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
/// document or PDF generation fails.
pub fn export_pdf(world: &ProjectWorld) -> Option<Vec<u8>> {
    world
        .with_document(|doc| pdf(doc, &PdfOptions::default()).ok())
        .flatten()
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
    fn no_document_renders_nothing() {
        let world = ProjectWorld::new();
        assert!(render_page(&world, 0).is_none());
        assert!(render_pages(&world, 0, 5).is_empty());
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
