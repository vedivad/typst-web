import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
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
