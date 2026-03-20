import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
  worker: {
    plugins: () => [wasm()],
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
});
