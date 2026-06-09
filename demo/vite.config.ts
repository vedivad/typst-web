import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves this from a subpath (/typst-web/); the deploy workflow
  // sets BASE_PATH. Defaults to "/" for local dev and previews.
  base: process.env.BASE_PATH ?? "/",
  worker: {
    format: "es",
  },
  resolve: {
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/lint"],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        minimal: resolve(__dirname, "minimal.html"),
      },
    },
  },
});
