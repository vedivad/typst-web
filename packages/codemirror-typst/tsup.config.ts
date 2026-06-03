import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@codemirror/autocomplete",
    "@codemirror/lint",
    "@codemirror/state",
    "@codemirror/view",
    "@vedivad/typst-web-service",
  ],
});
