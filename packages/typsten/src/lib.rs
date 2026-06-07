//! typsten: the Typst engine compiled to one WASM module with a typed project
//! API for JS.

mod compile;
mod diagnostics;
mod engine;
mod format;
mod highlight;
mod ide;
mod project;
mod render;
mod vfs;
mod world;

pub use compile::{CompileResult, PageInfo};
pub use diagnostics::{Diagnostic, Location, Severity};
pub use highlight::HlSpan;
pub use ide::{ClickJump, Completion, CompletionKind, CompletionResponse, Hover, HoverKind};
pub use project::Project;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
