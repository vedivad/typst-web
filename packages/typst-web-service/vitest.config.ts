import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [wasm()],
  test: {
    name: "typst-web-service",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
