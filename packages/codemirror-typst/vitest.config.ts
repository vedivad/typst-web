import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "codemirror-typst",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
