use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn version_matches_pinned_typst() {
    let v = typsten::Project::new().version();
    assert!(v.starts_with("0.14"), "unexpected typst version: {v}");
}

#[wasm_bindgen_test]
fn compiles_and_renders_a_page() {
    let mut p = typsten::Project::new();
    p.set_file("main.typ", b"= Hello".to_vec());
    p.set_entry("main.typ");
    let result = p.compile();
    assert!(!result.pages.is_empty(), "expected a page");
    let svg = p.render_page(0).expect("page 0 should render");
    assert!(svg.contains("<svg"), "expected svg output, got: {svg:.120}");
}

#[wasm_bindgen_test]
fn reports_diagnostics_on_error() {
    let mut p = typsten::Project::new();
    p.set_file("main.typ", b"#nope".to_vec());
    p.set_entry("main.typ");
    let result = p.compile();
    assert!(result.pages.is_empty(), "broken first compile has no page");
    assert!(
        !result.diagnostics.is_empty(),
        "expected diagnostics for unknown variable"
    );
}

#[wasm_bindgen_test]
fn completes_through_the_boundary() {
    let mut p = typsten::Project::new();
    p.set_file("main.typ", b"#i".to_vec());
    p.set_entry("main.typ");
    let response = p.complete("main.typ", 2, true).expect("completions");
    assert!(!response.completions.is_empty(), "expected completions");
}

#[wasm_bindgen_test]
fn formats_through_the_boundary() {
    let mut p = typsten::Project::new();
    p.set_file("main.typ", b"#let x=1+2\n".to_vec());
    let formatted = p.format("main.typ").expect("formatted output");
    assert!(formatted.contains("x = 1 + 2"), "got: {formatted:?}");
}

#[wasm_bindgen_test]
fn compiles_a_package_import() {
    let mut p = typsten::Project::new();
    p.set_file(
        "@preview/adder:0.1.0/typst.toml",
        b"[package]\nname = \"adder\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n".to_vec(),
    );
    p.set_file(
        "@preview/adder:0.1.0/lib.typ",
        b"#let add(x, y) = x + y\n".to_vec(),
    );
    p.set_file(
        "main.typ",
        b"#import \"@preview/adder:0.1.0\": add\n#add(2, 3)".to_vec(),
    );
    p.set_entry("main.typ");
    let result = p.compile();
    assert!(!result.pages.is_empty(), "package import should compile");
}
