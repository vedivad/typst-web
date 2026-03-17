import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "codemirror-shiki",
    "@codemirror/lint",
    "@codemirror/state",
    "@codemirror/view",
    "shiki",
    "shiki/wasm",
    "@vedivad/typst-web-service",
  ],
});
