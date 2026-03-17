import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wasm from "vite-plugin-wasm";
export default defineConfig({
  plugins: [wasm(), svelte()],
  resolve: {
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/lint"],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
});
