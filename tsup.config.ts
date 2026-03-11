import { defineConfig } from "tsup";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "iife",
  write: false,
  minify: true,
});

const workerCode = outputFiles[0].text;

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["@codemirror/lint", "@codemirror/state", "@codemirror/view"],
    define: { __WORKER_CODE__: JSON.stringify(workerCode) },
  },
  {
    entry: { worker: "src/worker.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    noExternal: [
      "@myriaddreamin/typst.ts",
      "@myriaddreamin/typst-ts-web-compiler",
    ],
  },
]);
