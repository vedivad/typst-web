//! Source formatting via `typstyle-core`.
//!
//! `typstyle-core` depends on the same `typst-syntax` 0.14.2 we already link,
//! so there is no second copy of the parser. It reuses the VFS `Source`, so the
//! text is not reparsed.

use typst::World;
use typstyle_core::{Config, Typstyle};

use crate::vfs::file_id;
use crate::world::ProjectWorld;

/// Format the file at `path`. Returns `None` if it is absent or has syntax
/// errors (invalid source cannot be formatted). Uses the default style
/// (tab_spaces 2, max_width 80).
pub fn format(world: &ProjectWorld, path: &str) -> Option<String> {
    let source = world.source(file_id(path)).ok()?;
    Typstyle::new(Config::new())
        .format_source(source)
        .render()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world_with(path: &str, text: &str) -> ProjectWorld {
        let mut world = ProjectWorld::new();
        world.set_file(path, text.as_bytes().to_vec());
        world
    }

    #[test]
    fn normalizes_spacing() {
        let world = world_with("main.typ", "#let x=1+2\n");
        let formatted = format(&world, "main.typ").expect("formatted output");
        assert!(
            formatted.contains("x = 1 + 2"),
            "expected normalized spacing, got: {formatted:?}"
        );
    }

    #[test]
    fn syntax_error_is_not_formatted() {
        let world = world_with("main.typ", "#(1 +");
        assert!(format(&world, "main.typ").is_none());
    }

    #[test]
    fn unknown_file_is_none() {
        let world = world_with("main.typ", "#let x = 1\n");
        assert!(format(&world, "nope.typ").is_none());
    }
}
