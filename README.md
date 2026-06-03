# typst-web

Typst editor components for the web, CodeMirror 6 extensions with compilation, autocompletion, hover, formatting, syntax highlighting, and live preview, all from a single Typst engine compiled to WebAssembly.

## Packages

| Package                                                              | Install                                  | Purpose                                                 |
| -------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| [`@vedivad/codemirror-typst`](packages/codemirror-typst/README.md)   | `npm install @vedivad/codemirror-typst`  | CodeMirror 6 editor integration, most users start here  |
| [`@vedivad/typst-web-service`](packages/typst-web-service/README.md) | `npm install @vedivad/typst-web-service` | Editor-agnostic engine (compile, render, format, IDE)   |
| [`@vedivad/typst-web-yjs`](packages/typst-web-yjs/README.md)         | `npm install @vedivad/typst-web-yjs yjs` | Optional Y.js adapters for collaborative Typst projects |

`@vedivad/codemirror-typst` re-exports everything from `@vedivad/typst-web-service`, so you only need one dependency.

## Quick start

```ts
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { createTypstSetup, TypstProject } from "@vedivad/codemirror-typst";

const project = await TypstProject.create();
await project.setText("/main.typ", "= Hello, Typst!");

// Bundles highlighting (colored out of the box), diagnostics, completion,
// hover, and compile-on-edit. Override colors with the `theme` option.
const setup = createTypstSetup({ project, sync: "editor-driven" });

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: project.getText("/main.typ") ?? "",
    extensions: [basicSetup, ...setup],
  }),
});
```

See the [`@vedivad/codemirror-typst` README](packages/codemirror-typst/README.md) for preview, formatting, theming, and multi-file setups.

## Demo

```bash
just dev
```

Two pages: `/` (tabbed multi-file editor with preview, diagnostics, completion/hover, PDF export, and formatting) and `/minimal.html` (single file + preview).

## Development

- [Bun](https://bun.sh), workspace scripts and package builds
- [just](https://just.systems), task runner (optional; `bun run` scripts also work)

| Command        | Description                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| `just install` | Install dependencies                                                                |
| `just build`   | Build the packages (the engine wasm builds via `bun run build:wasm`)                |
| `just test`    | Run tests with [Vitest](https://vitest.dev)                                         |
| `just format`  | Format with [Oxc Formatter (oxfmt)](https://oxc.rs/docs/guide/usage/formatter.html) |
| `just lint`    | Lint with [Oxlint](https://oxc.rs/docs/guide/usage/linter.html)                     |
| `just dev`     | Build packages and start the demo dev server                                        |

## License

MIT, see `LICENSE`.

This project compiles the [Typst](https://github.com/typst/typst) engine (and `typstyle`) to WebAssembly under Apache-2.0, with the default fonts from `typst-assets` embedded under their own permissive licenses. See `THIRD_PARTY_LICENSES`.
