import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
  test: {
    name: "typst-web-service",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
