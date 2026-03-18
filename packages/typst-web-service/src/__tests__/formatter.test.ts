import { describe, expect, it, vi } from "vitest";
import { TypstFormatter } from "../formatter.js";

describe("TypstFormatter", () => {
  it("formats typst source code", async () => {
    const formatter = new TypstFormatter({ max_width: 80 });
    const input = "#let   x  =  1";
    const result = await formatter.format(input);
    expect(result.trim()).toBe("#let x = 1");
  });

  it("formats a range within source", async () => {
    const formatter = new TypstFormatter();
    const source = "#let   x = 1\n#let   y = 2\n";
    const result = await formatter.formatRange(source, 0, 13);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("start");
    expect(result).toHaveProperty("end");
    expect(typeof result.text).toBe("string");
    expect(typeof result.start).toBe("number");
    expect(typeof result.end).toBe("number");
  });

  it("returns unchanged source when already formatted", async () => {
    const formatter = new TypstFormatter();
    const source = "#let x = 1\n";
    const result = await formatter.format(source);
    expect(result).toBe(source);
  });

  it("respects config options", async () => {
    const narrow = new TypstFormatter({ max_width: 20 });
    const wide = new TypstFormatter({ max_width: 200 });
    const source = "#let x = 1";
    const narrowResult = await narrow.format(source);
    const wideResult = await wide.format(source);
    expect(typeof narrowResult).toBe("string");
    expect(typeof wideResult).toBe("string");
  });
});

