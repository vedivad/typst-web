//! The Typst `World` implemented over the in-memory [`Vfs`].
//!
//! `ProjectWorld` is plain Rust (no `#[wasm_bindgen]`), so it is constructible
//! and exercisable under a host `cargo test` without a wasm runtime.

use std::collections::HashMap;

use parking_lot::Mutex;

#[cfg(test)]
use std::sync::atomic::{AtomicU32, Ordering};

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::layout::PagedDocument;
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_pdf::{PdfOptions, pdf};
use typst_svg::svg;

use crate::vfs::{Vfs, file_id};

/// An in-memory Typst project: a VFS plus the embedded fonts and library.
pub struct ProjectWorld {
    vfs: Vfs,
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    /// Index-aligned with `book`; `font(i)` returns `fonts[i]`. Grown by `add_font`.
    fonts: Vec<Font>,
    main: FileId,
    /// Parsed sources, cached and incrementally updated so `comemo` reuses
    /// eval/layout across compiles (stable content hash) and edits reparse only
    /// the changed region. Bounded by the live VFS: an entry is added on first
    /// read and dropped by `remove_file` (or a non-UTF-8 overwrite), so it never
    /// outlives its file - no separate eviction needed. `Mutex` because
    /// `World::source` is `&self`.
    sources: Mutex<HashMap<FileId, Source>>,
    /// The last successfully compiled document, so pages can be rendered on
    /// demand (and a transient error keeps the last good preview). Replaced only
    /// on a successful compile.
    document: Mutex<Option<PagedDocument>>,
    /// Test-only instrumentation: full parses (`Source::new`) vs incremental
    /// edits (`Source::replace`), so a test can confirm the incremental path.
    #[cfg(test)]
    full_parses: AtomicU32,
    #[cfg(test)]
    incremental_edits: AtomicU32,
}

impl ProjectWorld {
    pub fn new() -> Self {
        let (book, fonts) = embedded_fonts();
        Self {
            vfs: Vfs::new(),
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main: file_id("/main.typ"),
            sources: Mutex::new(HashMap::new()),
            document: Mutex::new(None),
            #[cfg(test)]
            full_parses: AtomicU32::new(0),
            #[cfg(test)]
            incremental_edits: AtomicU32::new(0),
        }
    }

    /// Insert or replace a file in the VFS from project-relative `path`. If a
    /// parsed `Source` is already cached for the file, it is refreshed in place
    /// via `Source::replace` (reparsing only the changed region). Uncached files
    /// (binary assets, first writes) skip the UTF-8 scan and parse lazily on
    /// first read.
    pub fn set_file(&mut self, path: &str, bytes: Vec<u8>) {
        let id = file_id(path);
        // Only the edit path (a Source already cached) needs the decoded text,
        // so gate the whole-buffer UTF-8 scan on cache presence.
        if self.sources.get_mut().contains_key(&id) {
            match std::str::from_utf8(&bytes) {
                Ok(text) => {
                    if let Some(source) = self.sources.get_mut().get_mut(&id) {
                        source.replace(text);
                    }
                    self.note_incremental_edit();
                }
                // Non-UTF-8 bytes cannot back a `Source`; drop the stale cached one.
                Err(_) => {
                    self.sources.get_mut().remove(&id);
                }
            }
        }
        self.vfs.set(id, Bytes::new(bytes));
    }

    /// Register every face in a font file (TTF/OTF, or a TTC collection),
    /// extending the embedded default fonts. Use it to add families the engine
    /// does not bundle, such as other scripts (CJK) or a brand font.
    pub fn add_font(&mut self, bytes: Vec<u8>) {
        let buffer = Bytes::new(bytes);
        for font in Font::iter(buffer) {
            self.book.push(font.info().clone());
            self.fonts.push(font);
        }
    }

    /// Remove a file from the VFS and its cached `Source`.
    pub fn remove_file(&mut self, path: &str) {
        let id = file_id(path);
        self.sources.get_mut().remove(&id);
        self.vfs.remove(id);
    }

    /// Set the entry (main) file that compilation starts from.
    pub fn set_entry(&mut self, path: &str) {
        self.main = file_id(path);
    }

    /// Cache a freshly compiled document so its pages can be rendered on demand.
    pub fn cache_document(&self, document: PagedDocument) {
        *self.document.lock() = Some(document);
    }

    /// Width and height (in points) of each page of the cached document.
    pub fn page_sizes(&self) -> Vec<(f64, f64)> {
        self.document.lock().as_ref().map_or_else(Vec::new, |doc| {
            doc.pages
                .iter()
                .map(|page| (page.frame.width().to_pt(), page.frame.height().to_pt()))
                .collect()
        })
    }

    /// Render a single page of the cached document to SVG, or `None` if there is
    /// no cached document or the index is out of range.
    pub fn render_page(&self, index: usize) -> Option<String> {
        self.document.lock().as_ref()?.pages.get(index).map(svg)
    }

    /// Render pages `[start, end)` of the cached document to SVG, clamping `end`
    /// to the page count. Empty if there is no document or the range is empty.
    pub fn render_pages(&self, start: usize, end: usize) -> Vec<String> {
        let document = self.document.lock();
        let Some(document) = document.as_ref() else {
            return Vec::new();
        };
        let end = end.min(document.pages.len());
        if start >= end {
            return Vec::new();
        }
        document.pages[start..end].iter().map(svg).collect()
    }

    /// Export the cached document to PDF bytes, or `None` if there is no cached
    /// document or PDF generation fails. PDF export of an already-laid-out
    /// document effectively never fails, so an error is mapped to `None` rather
    /// than surfaced - keeping the boundary as simple as `render_page`.
    pub fn export_pdf(&self) -> Option<Vec<u8>> {
        let document = self.document.lock();
        pdf(document.as_ref()?, &PdfOptions::default()).ok()
    }

    /// `(full_parses, incremental_edits)` since construction. Test instrumentation.
    #[cfg(test)]
    pub fn parse_counts(&self) -> (u32, u32) {
        (
            self.full_parses.load(Ordering::Relaxed),
            self.incremental_edits.load(Ordering::Relaxed),
        )
    }

    /// Record a full parse / incremental edit. No-ops unless built for tests.
    #[cfg(test)]
    fn note_full_parse(&self) {
        self.full_parses.fetch_add(1, Ordering::Relaxed);
    }
    #[cfg(not(test))]
    fn note_full_parse(&self) {}

    #[cfg(test)]
    fn note_incremental_edit(&self) {
        self.incremental_edits.fetch_add(1, Ordering::Relaxed);
    }
    #[cfg(not(test))]
    fn note_incremental_edit(&self) {}
}

impl Default for ProjectWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl World for ProjectWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        let mut cache = self.sources.lock();
        if let Some(source) = cache.get(&id) {
            // Unchanged content -> stable (content-based) hash, so comemo reuses
            // memoized eval/layout. The clone is just a cheap `Arc` bump.
            return Ok(source.clone());
        }
        // First access: full parse, then cache. Edits update it via `set_file`.
        let bytes = self.vfs.lookup(id)?;
        let text = bytes.as_str().map_err(|_| FileError::InvalidUtf8)?;
        let source = Source::new(id, text.to_string());
        self.note_full_parse();
        cache.insert(id, source.clone());
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.vfs.lookup(id).cloned()
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        // No clock: Rust does no I/O itself. A JS-pushed date can come later.
        None
    }
}

impl typst_ide::IdeWorld for ProjectWorld {
    fn upcast(&self) -> &dyn World {
        self
    }

    fn files(&self) -> Vec<FileId> {
        self.vfs.ids()
    }

    // `packages()` keeps its default (empty) until Milestone 6 adds package support.
}

/// Load the fonts embedded by `typst-assets`. Mirrors the embed pattern in
/// `typst-kit`'s `FontSearcher::add_embedded`, but without pulling in that
/// crate's native `fontdb`/`fontconfig` deps, which do not belong in a WASM
/// build.
fn embedded_fonts() -> (FontBook, Vec<Font>) {
    let mut book = FontBook::new();
    let mut fonts = Vec::new();
    for data in typst_assets::fonts() {
        let buffer = Bytes::new(data);
        // `Font::iter` handles TTC collections (one file, multiple faces).
        for font in Font::iter(buffer) {
            book.push(font.info().clone());
            fonts.push(font);
        }
    }
    (book, fonts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::compile_project;

    fn project(main_src: &str) -> ProjectWorld {
        let mut world = ProjectWorld::new();
        world.set_file("main.typ", main_src.as_bytes().to_vec());
        world.set_entry("main.typ");
        world
    }

    #[test]
    fn edit_is_reflected() {
        let mut world = project("= Alpha");
        compile_project(&world);
        let a = world.render_page(0).expect("page a");
        world.set_file("main.typ", b"= Beta".to_vec());
        compile_project(&world);
        let b = world.render_page(0).expect("page b");
        assert_ne!(a, b, "an edit should change the rendered output");
    }

    #[test]
    fn unchanged_recompile_is_stable() {
        let world = project("= Hello");
        let r1 = compile_project(&world);
        let first = world.render_page(0).expect("page");
        let r2 = compile_project(&world);
        let second = world.render_page(0).expect("page");
        assert_eq!(first, second, "unchanged recompile renders identically");
        assert!(r1.diagnostics.is_empty() && r2.diagnostics.is_empty());
    }

    #[test]
    fn edits_use_incremental_reparse() {
        let mut world = project("#let x = 1\n#x");

        // First compile parses main.typ once (a full parse).
        let _ = compile_project(&world);
        assert_eq!(world.parse_counts(), (1, 0));

        // Editing the cached source updates it in place, not via a rebuild.
        world.set_file("main.typ", b"#let x = 2\n#x".to_vec());
        assert_eq!(
            world.parse_counts(),
            (1, 1),
            "edit should reparse incrementally"
        );

        // Recompiling reflects the edit without another full parse.
        let _ = compile_project(&world);
        assert_eq!(
            world.parse_counts().0,
            1,
            "no extra full parse on recompile"
        );
    }

    #[test]
    fn exports_pdf_after_compile() {
        let world = project("= Hello");
        assert!(world.export_pdf().is_none(), "no document before compile");
        compile_project(&world);
        let pdf = world.export_pdf().expect("pdf bytes after compile");
        assert!(pdf.starts_with(b"%PDF-"), "valid PDF header");
    }
}
