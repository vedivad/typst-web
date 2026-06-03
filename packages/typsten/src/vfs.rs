//! The in-memory virtual file system backing a project.
//!
//! Per the core architecture principle, Rust does no I/O itself: this map is the
//! whole backing store, fed from JS. It is also the deliberate seam where a lazy,
//! JSPI-backed fetch backend slots in at Milestone 6 - hence a newtype with a
//! method surface rather than a bare `HashMap`, so callers never depend on the
//! storage being a map. No `trait` yet: there is only one implementation today,
//! and the M6 backend is async against Typst's synchronous `World::file`, so a
//! trait designed now would be guessed wrong. It gets extracted then.

use std::collections::HashMap;

use typst::diag::{FileError, FileResult};
use typst::foundations::Bytes;
use typst::syntax::package::PackageSpec;
use typst::syntax::{FileId, VirtualPath};

/// Resolve a path to the `FileId` used as the VFS key.
///
/// A path beginning with `@` is a package file (`@namespace/name:version/inner/path`)
/// and gets a package-qualified `FileId`; any other path is a project file. Project
/// paths are project-rooted and normalized by `VirtualPath::new`, so `"main.typ"` and
/// `"/main.typ"` address the same file.
pub fn file_id(path: &str) -> FileId {
    if path.starts_with('@') {
        if let Some((spec, vpath)) = parse_package_path(path) {
            return FileId::new(Some(spec), VirtualPath::new(vpath));
        }
    }
    FileId::new(None, VirtualPath::new(path))
}

/// Split `@namespace/name:version/inner/path` into its package spec and the path
/// within the package. The spec ends at the first `/` after the version's `:`.
fn parse_package_path(path: &str) -> Option<(PackageSpec, &str)> {
    let colon = path.find(':')?;
    let sep = colon + path[colon..].find('/')?;
    // `path[..sep]` keeps the leading `@`, which `PackageSpec::from_str` requires.
    let spec = path[..sep].parse::<PackageSpec>().ok()?;
    Some((spec, &path[sep + 1..]))
}

/// An in-memory file store keyed by `FileId`.
#[derive(Default)]
pub struct Vfs {
    files: HashMap<FileId, Bytes>,
}

impl Vfs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert or replace a file's bytes.
    pub fn set(&mut self, id: FileId, bytes: Bytes) {
        self.files.insert(id, bytes);
    }

    /// Remove a file, if present.
    pub fn remove(&mut self, id: FileId) {
        self.files.remove(&id);
    }

    /// Borrow a file's bytes, or a Typst `NotFound` error carrying its path.
    pub fn lookup(&self, id: FileId) -> FileResult<&Bytes> {
        self.files
            .get(&id)
            .ok_or_else(|| FileError::NotFound(id.vpath().as_rooted_path().into()))
    }

    /// All file ids currently in the VFS (used for path completion).
    pub fn ids(&self) -> Vec<FileId> {
        self.files.keys().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_path_has_no_package() {
        assert!(file_id("main.typ").package().is_none());
    }

    #[test]
    fn package_path_parses_spec_and_vpath() {
        let id = file_id("@preview/adder:0.1.0/src/lib.typ");
        let spec = id.package().expect("a package spec");
        assert_eq!(spec.namespace, "preview");
        assert_eq!(spec.name, "adder");
        assert_eq!(spec.version.to_string(), "0.1.0");
        assert_eq!(
            id.vpath().as_rootless_path().to_string_lossy(),
            "src/lib.typ"
        );
    }
}
