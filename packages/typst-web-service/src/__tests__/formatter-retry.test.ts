import { describe, expect, it, vi } from "vitest";

describe("TypstFormatter WASM retry", () => {
  it("retries after WASM load failure", async () => {
    let callCount = 0;

    // Use doMock (not hoisted) so we can reference callCount
    vi.doMock("@typstyle/typstyle-wasm-bundler", () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("WASM load failed");
      }
      return {
        format: (source: string) => `formatted: ${source}`,
        format_range: (source: string, start: number, end: number) => ({
          start,
          end,
          text: source.slice(start, end),
        }),
      };
    });

    // Dynamic import after mock is set up — gets a fresh module
    const { TypstFormatter } = await import("../formatter.js");
    const formatter = new TypstFormatter();

    // First call should fail (WASM load rejects)
    await expect(formatter.format("x")).rejects.toThrow();

    // Second call should retry and succeed (getTypstyle resets cache on failure)
    const result = await formatter.format("x");
    expect(result).toBe("formatted: x");
  });
});
