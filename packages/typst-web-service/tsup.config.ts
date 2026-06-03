import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { defineConfig } from "tsup";

// Bundle the single typsten worker (comlink + the typsten JS glue) into a
// self-contained IIFE, inlined into the main entry as __WORKER_CODE__ so
// `createWorker()` needs no extra bundler setup. The wasm itself is loaded at
// runtime from a URL, so it is intentionally NOT bundled here - instead it is
// copied into dist/ (onSuccess below) and self-resolved at runtime via
// `import.meta.url`, so every consumer gets the engine transitively without
// depending on typsten directly.
const { outputFiles } = await build({
  entryPoints: ["src/typsten-worker.ts"],
  bundle: true,
  format: "iife",
  write: false,
  minify: true,
});

const workerCode = outputFiles[0].text;

// The built wasm from the typsten workspace package (its `./typsten_bg.wasm`
// export). Requires `bun run --cwd packages/typsten build` to have run first.
let wasmSrc: string;
try {
  wasmSrc = createRequire(import.meta.url).resolve("typsten/typsten_bg.wasm");
} catch {
  throw new Error(
    "typsten wasm not found - build it first: `bun run --cwd packages/typsten build`",
  );
}

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __WORKER_CODE__: JSON.stringify(workerCode),
  },
  // Ship the engine wasm next to dist/index.js so `TypstProject.create()` can
  // self-resolve it via `new URL("./typsten_bg.wasm", import.meta.url)`.
  onSuccess: async () => {
    copyFileSync(wasmSrc, "dist/typsten_bg.wasm");
  },
});
