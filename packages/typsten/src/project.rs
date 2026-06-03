//! The wasm-bindgen facade.
//!
//! Convention: this is the ONLY module with `#[wasm_bindgen]`, and it holds no
//! logic - every method delegates in one line to the host-testable core. That
//! keeps all real logic on the host target where `cargo test` can reach it.

use wasm_bindgen::prelude::*;

use crate::compile::{CompileResult, compile_project};
use crate::ide::{self, CompletionResponse, Hover};
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

    /// Render a single page of the last compiled document to SVG, or `None` if
    /// nothing has compiled yet or the index is out of range.
    pub fn render_page(&self, index: usize) -> Option<String> {
        self.world.render_page(index)
    }

    /// Render pages `[start, end)` of the last compiled document to SVG (`end`
    /// clamped to the page count) - the on-demand path for a virtualized viewer.
    pub fn render_pages(&self, start: usize, end: usize) -> Vec<String> {
        self.world.render_pages(start, end)
    }
}
