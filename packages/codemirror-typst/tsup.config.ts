import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@codemirror/autocomplete",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/state",
    "@codemirror/view",
    // Externalized so its `tags` stay a single shared instance with the
    // consumer's themes; the converter matches tags by reference identity.
    "@lezer/highlight",
    "@vedivad/typst-web-service",
  ],
});
