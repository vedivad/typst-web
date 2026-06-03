//! Introspection of the linked Typst engine.

/// The Typst engine version this crate is built against, e.g. "0.14.2".
///
/// Read from the engine's own `sys.version`, which `typst-library` builds from
/// its `CARGO_PKG_VERSION`, so it tracks the linked Typst crate, not a string we
/// hardcode.
pub fn version() -> String {
    use typst::foundations::{Dict, Value, sys};

    let module = sys::module(Dict::new());
    match module.scope().get("version").map(|binding| binding.read()) {
        Some(Value::Version(version)) => version.to_string(),
        _ => "unknown".to_string(),
    }
}
