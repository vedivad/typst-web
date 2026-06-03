import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

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
  entry: {
    index: "src/index.ts",
    "typsten-worker": "src/typsten-worker.ts",
  },
  format: ["esm"],
  splitting: false,
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  clean: true,
  // Ship the engine wasm next to the outputs so `TypstProject.create()` can
  // self-resolve it via `new URL("./typsten_bg.wasm", import.meta.url)`.
  onSuccess: async () => {
    copyFileSync(wasmSrc, "dist/typsten_bg.wasm");
  },
});
