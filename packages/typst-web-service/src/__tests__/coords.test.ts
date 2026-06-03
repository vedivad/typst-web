import { describe, expect, it } from "vitest";
import {
  byteOffsetsToCm,
  byteToCmOffset,
  cmOffsetsToByte,
  cmOffsetToByte,
} from "../coords.js";

describe("byteOffsetsToCm", () => {
  it("is identity for pure-ASCII text", () => {
    const text = "#let x = 1";
    const offsets = [0, 1, 4, 10];
    expect(byteOffsetsToCm(text, offsets)).toEqual(offsets);
  });

  it("matches byteToCmOffset at every code-point boundary of multibyte text", () => {
    // "é" is 2 UTF-8 bytes / 1 UTF-16 unit; "🎉" is 4 bytes / 2 units. Highlight
    // span boundaries always land on code-point boundaries, so we only test those.
    const text = "a é b 🎉 c";
    const encoder = new TextEncoder();
    const boundaries: number[] = [];
    let byte = 0;
    for (const ch of text) {
      boundaries.push(byte);
      byte += encoder.encode(ch).length;
    }
    boundaries.push(byte); // end of string

    const batch = byteOffsetsToCm(text, boundaries);
    for (let i = 0; i < boundaries.length; i++) {
      expect(batch[i]).toBe(byteToCmOffset(text, boundaries[i]));
    }
  });

  it("handles non-monotonic input (nested span boundaries) and preserves order", () => {
    const text = "é = 🎉"; // bytes: é[0,2) space[2,3) =[3,4) space[4,5) 🎉[5,9)
    // A parent span [0,9) wrapping a child [5,9): flattened boundaries interleave.
    const result = byteOffsetsToCm(text, [0, 9, 5, 9]);
    expect(result).toEqual([
      byteToCmOffset(text, 0),
      byteToCmOffset(text, 9),
      byteToCmOffset(text, 5),
      byteToCmOffset(text, 9),
    ]);
  });

  it("clamps offsets past the end to the document length", () => {
    const text = "é"; // 2 bytes, 1 UTF-16 unit
    expect(byteOffsetsToCm(text, [99])).toEqual([1]);
  });
});

describe("cmOffsetsToByte", () => {
  it("is identity for pure-ASCII text", () => {
    const offsets = [0, 1, 4, 10];
    expect(cmOffsetsToByte("#let x = 1", offsets)).toEqual(offsets);
  });

  it("matches cmOffsetToByte at every code-point boundary of multibyte text", () => {
    const text = "a é b 🎉 c";
    const bounds: number[] = [];
    let cm = 0;
    for (const ch of text) {
      bounds.push(cm);
      cm += ch.length; // 1 for a BMP char, 2 for a surrogate pair
    }
    bounds.push(cm);
    const batch = cmOffsetsToByte(text, bounds);
    for (let i = 0; i < bounds.length; i++) {
      expect(batch[i]).toBe(cmOffsetToByte(text, bounds[i]));
    }
  });

  it("round-trips with byteOffsetsToCm", () => {
    const text = "é = 🎉 x"; // 🎉 spans cm 4-6, so cm 5 is mid-surrogate (skip it)
    const cmBounds = [0, 1, 4, 6, 7]; // all code-point boundaries
    const bytes = cmOffsetsToByte(text, cmBounds);
    expect(byteOffsetsToCm(text, bytes)).toEqual(cmBounds);
  });
});
