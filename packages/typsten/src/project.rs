//! The wasm-bindgen facade.
//!
//! Convention: this is the ONLY module with `#[wasm_bindgen]`, and it holds no
//! logic, every method delegates in one line to the host-testable core. That
//! keeps all real logic on the host target where `cargo test` can reach it.

use wasm_bindgen::prelude::*;

use crate::compile::{CompileResult, compile_project};
use crate::highlight::HlSpan;
use crate::ide::{self, ClickJump, CompletionResponse, CursorJump, Hover};
use crate::render;
use crate::world::ProjectWorld;

/// How many compile generations of memoized results `comemo` retains. Trimmed
/// after each compile to bound memory across an editing session.
const COMEMO_MAX_AGE: usize = 10;

/// The typsten project handle. JS pushes files in and asks for compiled output.
#[wasm_bindgen]
pub struct Project {
    world: ProjectWorld,
}

#[wasm_bindgen]
impl Project {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Project {
        Project {
            world: ProjectWorld::new(),
        }
    }

    /// The Typst engine version this crate is built against, e.g. "0.14.2".
    pub fn version(&self) -> String {
        crate::engine::version()
    }

    /// Insert or replace a file in the VFS. Source files are just their UTF-8
    /// bytes; package and asset bytes are stored the same way.
    pub fn set_file(&mut self, path: &str, bytes: Vec<u8>) {
        self.world.set_file(path, bytes);
    }

    /// Remove a file from the VFS.
    pub fn remove_file(&mut self, path: &str) {
        self.world.remove_file(path);
    }

    /// Set the entry (main) file that compilation starts from.
    pub fn set_entry(&mut self, path: &str) {
        self.world.set_entry(path);
    }

    /// Set the date `datetime.today()` returns. WASM has no clock, so JS
    /// pushes this in (typically the user's local date) before each compile.
    pub fn set_today(&mut self, year: i32, month: u8, day: u8, hour: u8, minute: u8, second: u8) {
        self.world.set_today(year, month, day, hour, minute, second);
    }

    /// Register a font file (TTF/OTF, or a TTC collection) for compilation,
    /// extending the embedded default fonts with families the engine does not
    /// bundle (e.g. CJK or a custom font). Returns the canonical family name of
    /// each added face (the name Typst groups and matches by).
    pub fn add_font(&mut self, bytes: Vec<u8>) -> Vec<String> {
        self.world.add_font(bytes)
    }

    /// Drop every font added via `add_font`, resetting to the embedded defaults.
    /// The engine has no per-font removal, so to remove a font, call this and
    /// re-`add_font` the ones to keep.
    pub fn clear_fonts(&mut self) {
        self.world.clear_fonts();
    }

    /// Compile the project, returning the rendered SVG and typed diagnostics.
    ///
    /// A query, so `&self`: the `Source` cache it touches is interior-mutable.
    pub fn compile(&self) -> CompileResult {
        let result = compile_project(&self.world);
        // Session-level memory management: trim memoized entries the recent
        // compiles no longer touch. Lives here, not in the pure compile core.
        comemo::evict(COMEMO_MAX_AGE);
        result
    }

    /// Completions at a byte-offset `cursor` in `path`. `explicit` is `true`
    /// when the user explicitly requested completion (e.g. Ctrl-Space).
    pub fn complete(
        &self,
        path: &str,
        cursor: usize,
        explicit: bool,
    ) -> Option<CompletionResponse> {
        ide::complete(&self.world, path, cursor, explicit)
    }

    /// Hover tooltip at a byte-offset `cursor` in `path`.
    pub fn hover(&self, path: &str, cursor: usize) -> Option<Hover> {
        ide::hover(&self.world, path, cursor)
    }

    /// Format the file at `path`, returning the formatted source or `None` if
    /// it is absent or has syntax errors.
    pub fn format(&self, path: &str) -> Option<String> {
        crate::format::format(&self.world, path)
    }

    /// Syntax-highlight `text`, returning the spans overlapping the byte window
    /// `[from, to)` (the editor's visible viewport; pass `0..len` for all of it).
    /// Stateless: it parses `text` directly, so it neither reads nor mutates the
    /// VFS and works for the live buffer and hover snippets alike.
    pub fn highlight(&self, text: &str, from: usize, to: usize) -> Vec<HlSpan> {
        crate::highlight::highlight_spans(text, from, to)
    }

    /// Syntax-highlight `text` to nested `<span class="typ-*">` HTML, for static
    /// contexts like hover tooltips. Stateless, like `highlight`.
    pub fn highlight_html(&self, text: &str) -> String {
        crate::highlight::highlight_html_string(text)
    }

    /// Render a single page of the last compiled document to SVG, or `None` if
    /// nothing has compiled yet or the index is out of range.
    pub fn render_page(&self, index: usize) -> Option<String> {
        render::render_page(&self.world, index)
    }

    /// Render pages `[start, end)` of the last compiled document to SVG (`end`
    /// clamped to the page count), the on-demand path for a virtualized viewer.
    pub fn render_pages(&self, start: usize, end: usize) -> Vec<String> {
        render::render_pages(&self.world, start, end)
    }

    /// Export the last compiled document as PDF bytes, or `None` if nothing has
    /// compiled yet. Returns a `Uint8Array` across the boundary.
    pub fn export_pdf(&self) -> Option<Vec<u8>> {
        render::export_pdf(&self.world)
    }

    /// Resolve a click at `(x, y)` points on page `index` of the last compiled
    /// document: a source location to jump the editor to, an internal link target
    /// to scroll the preview to, or a URL. `None` if nothing compiled, the page is
    /// out of range, or the click hit nothing actionable.
    pub fn click_jump(&self, index: usize, x: f64, y: f64) -> Option<ClickJump> {
        ide::click_jump(&self.world, index, x, y)
    }

    /// Resolve a `cursor` (byte offset) in `path` to where it renders in the last
    /// compiled document (0-based page + point in points), or `None`. The reverse
    /// of `click_jump`, for scrolling the preview to follow the editor cursor.
    pub fn jump_from_cursor(&self, path: &str, cursor: usize) -> Option<CursorJump> {
        ide::jump_from_cursor(&self.world, path, cursor)
    }
}

impl Default for Project {
    fn default() -> Self {
        Self::new()
    }
}
