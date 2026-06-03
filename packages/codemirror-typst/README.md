# @vedivad/codemirror-typst

CodeMirror 6 extensions for Typst - syntax highlighting, diagnostics, autocompletion, hover tooltips, formatting, and live preview, all powered by a single Typst engine compiled to WebAssembly.

Re-exports everything from `@vedivad/typst-web-service`, so you only need this one dependency.

## Install

```bash
npm install @vedivad/codemirror-typst
```

## Prerequisites

A bundler with WebAssembly support - e.g. [Vite](https://vite.dev) with [`vite-plugin-wasm`](https://github.com/nicolo-ribaudo/vite-plugin-wasm). The Typst engine wasm ships inside `@vedivad/typst-web-service` and is loaded into a Web Worker at runtime; there are no separate compiler, renderer, analyzer, or formatter binaries to wire up. Completions, hover, diagnostics, and formatting all come from that one engine.

## Quick start

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  createTypstHighlighting,
  createTypstSetup,
  TypstProject,
} from "@vedivad/codemirror-typst";

// One project owns the in-memory file system, the compile schedule, and the
// engine worker. Share it across editors that should see the same files.
const project = await TypstProject.create();
await project.setText("/main.typ", "= Hello, Typst!");

const highlighting = createTypstHighlighting({ project, theme: "dark" });
const setup = createTypstSetup({
  project,
  sync: "editor-driven",
  highlighting,
});

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: project.getText("/main.typ") ?? "",
    extensions: [basicSetup, ...setup /* typstFilePath.of("/main.typ") */],
  }),
});
```

`createTypstSetup` bundles highlighting, the lint gutter, compile-on-edit, diagnostics, autocompletion, hover, and (optionally) the formatter. `sync: "editor-driven"` makes CodeMirror the source of truth and mirrors edits into the project; use `sync: "external"` when something else (Y.js, a server) writes into the project.

## Live preview

`compile()` lays out the document and returns each page's dimensions; pages are rendered to SVG on demand, so a viewer can render only what's visible. Subscribe with `onCompile`:

```ts
project.onCompile(async (result) => {
  // result.diagnostics - errors/warnings; result.pages - per-page dimensions
  const pages = await project.renderedPages(0, result.pages.length);
  document.querySelector("#preview")!.innerHTML = pages
    .map((p) => `<div class="page">${p.svg}</div>`)
    .join("");
});

await project.compile(); // first render immediately (bypasses the debounce)
```

Export the last compile to PDF with `await project.exportPdf()` (returns `Uint8Array | undefined`).

## TypstProject

`TypstProject` owns the virtual file system and the engine worker.

```ts
const project = await TypstProject.create({
  entry: "/main.typ", // default compile entry (default: "/main.typ")
  autoCompile: { debounceMs: 300, maxWaitMs: 2000 },
  packages: true, // fetch @preview packages over HTTP on demand (default: true)
});

await project.setMany({ "/main.typ": "...", "/logo.svg": bytes });
project.getText("/main.typ"); // tracked text, or undefined
project.files; // tracked text file paths
await project.remove("/old.typ");
await project.clear(); // drop project files (cached @preview packages are kept)
project.destroy(); // tear down the worker
```

VFS mutations (`setText`, `setMany`, `setBinary`, `remove`, `clear`, entry change) auto-schedule a compile; subscribe to results with `onCompile`. Call `compile()` to flush a pending compile and get the fresh result.

## Multi-file editor

Attach the `typstFilePath` facet per-editor so each `EditorState` carries its own path. Switching tabs with `view.setState(states[path])` propagates the new path automatically - no external `activeFile` variable required.

```ts
import { createTypstSetup, typstFilePath } from "@vedivad/codemirror-typst";

await project.setMany({ "/main.typ": "...", "/template.typ": "..." });

const setup = createTypstSetup({ project, sync: "editor-driven" });
const shared = [basicSetup, ...setup];

const states = Object.fromEntries(
  project.files.map((path) => [
    path,
    EditorState.create({
      doc: project.getText(path) ?? "",
      extensions: [...shared, typstFilePath.of(path)],
    }),
  ]),
);
```

## Compile timing

`TypstProject` auto-compiles after every VFS mutation; the editor plugin only mirrors CodeMirror edits into `setText`. Configure the schedule once per project:

| Option                   | Default | Behavior                                                                                                  |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `autoCompile.debounceMs` | `0`     | Debounce - resets on every mutation, fires once mutations pause. `0` means compile on the next macrotask. |
| `autoCompile.maxWaitMs`  | `0`     | Max-wait cap - forces a compile during sustained mutation bursts. Only effective when `debounceMs` > 0.   |

VFS mutations schedule a _debounced_ compile, so the first render is delayed by `debounceMs`. Call `compile()` explicitly to render initial output immediately:

```ts
await project.setMany({ "/main.typ": "= Hello!" });
await project.compile(); // bypass the debounce for the first render
```

## Format on save

```ts
createTypstSetup({
  project,
  sync: "editor-driven",
  formatter: { formatOnSave: true },
});
```

`formatOnSave` can also be a `(content: string) => void` callback (format, then receive the result, e.g. to persist it). The formatter binds `Shift-Alt-f` by default (override with `keybinding`). It runs the engine's built-in `typstyle` formatter - nothing extra to install.

## Theme switching

Highlighting is computed by the same typst-syntax engine that compiles the document (via the project worker), so tokens are exactly what the parser sees - there is no separate grammar. Tokens carry Typst's stable `typ-*` classes, themed by a built-in `light`/`dark` palette; the editor and hover code blocks share it. Override the `themes` option (or style the `typ-*` classes from your own CSS) to customise colors.

`createTypstHighlighting` is synchronous (nothing to preload) and returns a controller you keep at the call site. Call `setTheme(view, alias)` to swap the active theme on a mounted `EditorView`:

```ts
const highlighting = createTypstHighlighting({ project, theme: "light" });
const setup = createTypstSetup({
  project,
  sync: "editor-driven",
  highlighting,
});

highlighting.setTheme(view, "dark");
```

The same controller may be shared across views, but CodeMirror compartments are reconfigured per view - call `setTheme` once per mounted view.

## External sync / Y.js

For collaborative editors, let your shared document model own the text and mirror it into `TypstProject`. Pass `sync: "external"` to `createTypstSetup` so it does not install the editor-to-project sync plugin; diagnostics, highlighting, completion/hover, and formatting still work against the project state you provide.

```ts
import { syncYTextToTypstProject } from "@vedivad/typst-web-yjs";

const project = await TypstProject.create({
  autoCompile: { debounceMs: 500, maxWaitMs: 2000 },
});

const sync = syncYTextToTypstProject({ project, ytext, path: "/main.typ" });
await sync.ready;

const setup = createTypstSetup({ project, sync: "external" });
// ... wire your collab binding (e.g. y-codemirror.next) into the editor.
```

For multi-file collaboration, keep a Y.js map of paths to documents and sync it with `syncYMapToTypstProject({ project, files })`. The adapter serializes async project writes so bursts of local and remote edits settle on the latest Y.js state.

## Granular plugins

`createTypstSetup` composes the default bundle. Use the pieces directly for custom UI, external sync, or a subset of features:

- **`createTypstCompileSync({ project })`** - mirrors the editor's content into the project's VFS on mount and on every change (the project auto-schedules the compile).
- **`createTypstDiagnostics({ project })`** - subscribes to `project.onCompile` and dispatches diagnostics for the active file.
- **`typstCompletionSource({ project })`** - plugs Typst completions into your own `autocompletion(...)`.
- **`createTypstHover({ project })`** - Typst hover tooltips (descriptions and syntax-highlighted value snippets).
- **`createTypstFormatter({ project, formatOnSave?, keybinding? })`** - formatting keybinding and optional format-on-save.

```ts
import { autocompletion } from "@codemirror/autocomplete";
import {
  createTypstCompileSync,
  createTypstDiagnostics,
  createTypstFormatter,
  createTypstHover,
  typstCompletionSource,
  typstFilePath,
} from "@vedivad/codemirror-typst";

const extensions = [
  createTypstCompileSync({ project }),
  createTypstDiagnostics({ project }),
  autocompletion({ override: [typstCompletionSource({ project })] }),
  createTypstHover({ project }),
  createTypstFormatter({ project }),
  typstFilePath.of("/main.typ"),
];
```

## Styling

The package ships no CSS - token colors come from the highlighting palette (or your overrides of the `typ-*` classes), and the hover tooltip exposes two stable hooks:

- `.cm-typst-hover` - the tooltip container (a plain-text description, or a code value).
- `.cm-typst-hover-code` - the syntax-highlighted code block inside a code hover.

Set `max-height` / `overflow` on `.cm-typst-hover` yourself if you want long tooltips to scroll.

## License

MIT
