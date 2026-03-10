# codemirror-typst-linter [experimental]

A CodeMirror 6 extension that shows Typst diagnostics as you type, using [@myriaddreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts) for compilation in a Web Worker.

For syntax highlighting [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst) can be used separately.

## Installation

```bash
npm install codemirror-typst-linter
```

Peer dependencies:

```bash
npm install @codemirror/lint @codemirror/state @codemirror/view
```

## Usage

```ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { typstLinter } from 'codemirror-typst-linter';

const view = new EditorView({
  state: EditorState.create({
    extensions: [
      typstLinter(),
    ],
  }),
  parent: document.body
});
```

## Options

```ts
typstLinter({
  // Font URLs passed to the Typst compiler.
  // Defaults to Roboto from jsDelivr.
  fonts: ['[https://example.com/myfont.ttf](https://example.com/myfont.ttf)'],

  // URL to the typst-ts-web-compiler WASM binary.
  // Defaults to the matching version on jsDelivr CDN.
  // Override for offline support or faster load:
  wasmUrl: new URL(
    '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
    import.meta.url,
  ).href,

  // Debounce delay in ms before linting fires after a change. Default: 0.
  delay: 300,

  // Include diagnostics from imported packages, not just the main file. Default: false.
  includePackageDiagnostics: false,
})
```

## Bundler setup

Because this package relies on `@myriaddreamin/typst.ts`, which uses modern WebAssembly features, you may need to configure your bundler to support WebAssembly and Top-Level Await. 

By default, the actual `.wasm` binary is fetched from jsDelivr at runtime, but the bundler still needs to understand the syntax during the build step.

### Vite Configuration
If you are using Vite, you must install `vite-plugin-wasm` and `vite-plugin-top-level-await`:

```bash
npm install -D vite-plugin-wasm vite-plugin-top-level-await
```

Then add them to your `vite.config.ts`:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
```

### Serving WASM Locally
If you want to serve the `.wasm` file locally instead of relying on the CDN, you can download the matching version of `typst_ts_web_compiler_bg.wasm` and pass its local URL to the `wasmUrl` option:

```ts
typstLinter({
  wasmUrl: new URL('./assets/typst_ts_web_compiler_bg.wasm', import.meta.url).href
})
```

## License

MIT — see [LICENSE](LICENSE).

This package bundles `@myriaddreamin/typst.ts` and `@myriaddreamin/typst-ts-web-compiler`, licensed under Apache-2.0. See [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
