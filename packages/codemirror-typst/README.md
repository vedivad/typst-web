# @vedivad/codemirror-typst

CodeMirror 6 extensions for Typst: syntax highlighting, diagnostics, autocompletion, hover tooltips, formatting, and live preview, all powered by a single Typst engine compiled to WebAssembly.

Re-exports everything from `@vedivad/typst-web-service`, so you only need this one dependency.

## Install

```bash
npm install @vedivad/codemirror-typst
```

## Prerequisites

A bundler with WebAssembly support, e.g. [Vite](https://vite.dev) with [`vite-plugin-wasm`](https://github.com/nicolo-ribaudo/vite-plugin-wasm). The Typst engine wasm ships inside `@vedivad/typst-web-service` and is loaded into a Web Worker at runtime; there are no separate compiler, renderer, analyzer, or formatter binaries to wire up. Completions, hover, diagnostics, and formatting all come from that one engine.

The engine bundles default body, math, and monospace fonts, so documents render out of the box. Add families it does not ship (e.g. CJK or a brand font) with `project.addFont(bytes)` (see the [service README](../typst-web-service/README.md#fonts)).

## Quick start

```ts
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { createTypstSetup, TypstProject } from "@vedivad/codemirror-typst";

// One project owns the in-memory file system, the compile schedule, and the
// engine worker. Share it across editors that should see the same files.
const project = await TypstProject.create();
await project.setText("/main.typ", "= Hello, Typst!");

const setup = createTypstSetup({ project, sync: "editor-driven" });

new EditorView({
  parent: document.querySelector("#app")!,
  state: EditorState.create({
    doc: project.getText("/main.typ") ?? "",
    extensions: [basicSetup, ...setup /* typstFilePath.of("/main.typ") */],
  }),
});
```

`createTypstSetup` bundles syntax highlighting (decorations plus a default light token theme), the lint gutter, compile-on-edit, diagnostics, autocompletion, hover, and (optionally) the formatter, so it is colored out of the box. `sync: "editor-driven"` makes CodeMirror the source of truth and mirrors edits into the project; use `sync: "external"` when something else (Y.js, a server) writes into the project. Override or switch the palette with the `theme` option (see [Theming](#theming)).

## Live preview

`compile()` lays out the document and returns each page's dimensions; pages are rendered to SVG on demand, so a viewer can render only what's visible. Subscribe with `onCompile`:

```ts
project.onCompile(async (result) => {
  // result.diagnostics: errors/warnings. result.pages: per-page dimensions
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

Attach the `typstFilePath` facet per-editor so each `EditorState` carries its own path. Switching tabs with `view.setState(states[path])` propagates the new path automatically, so no external `activeFile` variable is required.

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

| Option                   | Default | Behavior                                                                                                 |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `autoCompile.debounceMs` | `0`     | Debounce. Resets on every mutation, fires once mutations pause. `0` means compile on the next macrotask. |
| `autoCompile.maxWaitMs`  | `0`     | Max-wait cap. Forces a compile during sustained mutation bursts. Only effective when `debounceMs` > 0.   |

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

`formatOnSave` can also be a `(content: string) => void` callback (format, then receive the result, e.g. to persist it). The formatter binds `Shift-Alt-f` by default (override with `keybinding`). It runs the engine's built-in `typstyle` formatter, with nothing extra to install.

## Theming

Highlighting is computed by the same typst-syntax engine that compiles the document (via the project worker), so tokens are exactly what the parser sees, with no separate grammar. Tokens carry Typst's stable `typ-*` classes; the editor and hover code blocks share one palette.

`createTypstSetup` includes a default light palette. Override it with the `theme` option, which takes any token theme built by `typstTheme`:

```ts
import {
  createTypstSetup,
  defaultDarkTheme,
  typstTheme,
} from "@vedivad/codemirror-typst";

const setup = createTypstSetup({
  project,
  sync: "editor-driven",
  theme: typstTheme(defaultDarkTheme),
});
```

`typstTheme` accepts the built-in `defaultLightTheme`/`defaultDarkTheme`, a raw `TokenTheme` (a map of `.typ-*` selectors to styles), or **any CodeMirror `HighlightStyle`** - including the `TagStyle[]` that [`@uiw` themes](https://www.npmjs.com/package/@uiw/codemirror-themes-all) export. Styles are bridged to the `typ-*` classes via `tokenThemeFromHighlightStyle`, so the whole CodeMirror theme ecosystem works for free. The token palette carries only colors; the editor's dark/light base belongs to your chrome theme (`oneDark`, `githubLight`, ...).

### Switching themes live

`typstThemes` bundles a named selection behind one compartment with a single typed `set(view, key)` switch point. Each entry is a `{ editor?, tokens }` descriptor (the `tokens` style is bridged for you, `editor` is the optional chrome theme) or a ready extension:

```ts
import {
  githubDark,
  githubDarkStyle,
  githubLight,
  githubLightStyle,
} from "@uiw/codemirror-theme-github";
import { createTypstSetup, typstThemes } from "@vedivad/codemirror-typst";

const themes = typstThemes(
  {
    light: { editor: githubLight, tokens: githubLightStyle },
    dark: { editor: githubDark, tokens: githubDarkStyle },
  },
  "light",
);

const setup = createTypstSetup({
  project,
  sync: "editor-driven",
  theme: themes.extension,
});

// later, e.g. on a light/dark toggle:
themes.set(view, "dark");
```

Two entries make a toggle, more make a picker - the selection and the active key are yours. `set` dispatches a reconfigure to the given view; CodeMirror compartments are per editor state, so in a multi-view app re-apply the active key when a view mounts. (Or skip `typstThemes` and put a `typstTheme(...)` in your own `Compartment`.)

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

- **`typstHighlighting({ project, debounceMs? })`** - the syntax-highlighting decorations (theme-independent); pair it with a `typstTheme(...)` for the colors.
- **`typstTheme(themeOrStyle)`** - the `typ-*` token palette as a theme extension (see [Theming](#theming)).
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
  defaultLightTheme,
  typstCompletionSource,
  typstFilePath,
  typstHighlighting,
  typstTheme,
} from "@vedivad/codemirror-typst";

const extensions = [
  typstHighlighting({ project }),
  typstTheme(defaultLightTheme),
  createTypstCompileSync({ project }),
  createTypstDiagnostics({ project }),
  autocompletion({ override: [typstCompletionSource({ project })] }),
  createTypstHover({ project }),
  createTypstFormatter({ project }),
  typstFilePath.of("/main.typ"),
];
```

## Styling

The package ships no CSS, token colors come from the `typstTheme` you install (or your own CSS targeting the `typ-*` classes), and the hover tooltip exposes two stable hooks:

- `.cm-typst-hover`, the tooltip container (a plain-text description, or a code value).
- `.cm-typst-hover-code`, the syntax-highlighted code block inside a code hover.

Set `max-height` / `overflow` on `.cm-typst-hover` yourself if you want long tooltips to scroll.

## License

MIT
