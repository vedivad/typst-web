# @vedivad/typst-web-service

Editor-agnostic Typst engine for the web: compile, render, format, autocomplete, hover, and syntax-highlight, all from a single Typst engine compiled to WebAssembly and run in a Web Worker.

Everything goes through one class, `TypstProject`. It owns an in-memory file system, mirrors your files into the worker, schedules compiles, and forwards engine queries.

## Install

```bash
npm install @vedivad/typst-web-service
```

> Most users should install `@vedivad/codemirror-typst` instead, which re-exports everything here and adds CodeMirror 6 integration.

## Prerequisites

A bundler with WebAssembly support (e.g. [Vite](https://vite.dev) with [`vite-plugin-wasm`](https://github.com/nicolo-ribaudo/vite-plugin-wasm)). The engine wasm ships inside this package and is loaded into a worker at runtime; there are no separate binaries to wire up.

## Compile and render

```ts
import { TypstProject } from "@vedivad/typst-web-service";

const project = await TypstProject.create();

await project.setMany({
  "/main.typ": '#import "/template.typ": greet\n#greet("World")',
  "/template.typ": "#let greet(name) = [Hello, #name!]",
});

const result = await project.compile();
// result.diagnostics: errors/warnings (deterministic order)
// result.pages: per-page dimensions (compile lays out; SVG is rendered on demand)

const pages = await project.renderedPages(0, result.pages.length);
document.querySelector("#preview")!.innerHTML = pages
  .map((page) => `<div class="page">${page.svg}</div>`)
  .join("");

// Export the last compile to PDF
const pdf = await project.exportPdf();
if (pdf) {
  const blob = new Blob([pdf.slice()], { type: "application/pdf" });
}

project.destroy();
```

`compile()` returns the fresh result and also fires `onCompile` listeners; subscribe for reactive updates:

```ts
const unsubscribe = project.onCompile((result) => {
  /* result.pages, result.diagnostics */
});
```

Rendering is on demand so a viewer can virtualize: `renderPage(index)` returns one page's SVG, `renderedPages(start, end)` returns `{ index, width, height, svg }` for a range.

## Fonts

The engine bundles Typst's default fonts (Libertinus Serif for body, New Computer Modern Math for equations, DejaVu Sans Mono for raw/code), so documents render out of the box. Use `addFont` to register families the engine does not ship - other scripts (CJK), or a brand/custom font:

```ts
const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
await project.addFont(bytes); // TTF/OTF or a TTC collection
```

Added fonts persist for the project's lifetime, and adding one schedules a recompile.

## Compile scheduling

VFS mutations (`setText`, `setMany`, `setBinary`, `remove`, `clear`, entry change) auto-schedule a debounced compile. Configure it per project; call `compile()` to flush immediately.

```ts
const project = await TypstProject.create({
  entry: "/main.typ", // default compile entry (default: "/main.typ")
  autoCompile: { debounceMs: 300, maxWaitMs: 2000 },
});
```

| Option                   | Default | Behavior                                                                             |
| ------------------------ | ------- | ------------------------------------------------------------------------------------ |
| `autoCompile.debounceMs` | `0`     | Coalesce a burst of mutations into one compile, firing once they pause.              |
| `autoCompile.maxWaitMs`  | `0`     | Force a compile at least this often during sustained mutation. Needs `debounceMs`>0. |

`@preview` packages are fetched over HTTP on demand: when a source imports `@preview/...`, the referenced package is downloaded and pushed into the VFS before the compile runs. Sources with no such imports never hit the network.

## Editor intelligence

Completions, hover, formatting, and highlighting come from the engine's own `typst-ide` and `typst-syntax`; there is no separate language server. The IDE methods take the live editor buffer (`source`) so they work whether or not the project's VFS is already current. Offsets are CodeMirror (UTF-16) positions.

```ts
const completions = await project.completion("/main.typ", source, offset);
const hover = await project.hover("/main.typ", source, offset);
const formatted = await project.format("/main.typ", source);

// Syntax highlighting: spans for a viewport, or ready HTML for a snippet.
const spans = await project.highlight(source, viewportFrom, viewportTo);
const html = await project.highlightHtml(codeSnippet);
```

## Offsets

The engine speaks UTF-8 byte offsets; editors speak UTF-16. `cmOffsetToByte` and `byteToCmOffset` convert a single position; the project's own methods accept and return CodeMirror offsets, so you only need these if you work with raw engine offsets directly.

## License

MIT
