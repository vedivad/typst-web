import { describe, expect, it } from "vitest";
import {
  clientToPagePoint,
  pageRenderedHeight,
  pageScale,
  scrollTopForPageY,
} from "../preview.js";

describe("pageScale", () => {
  it("is rendered width over point width", () => {
    // An A4 page (595.28pt) rendered 700px wide.
    expect(pageScale(700, 595.28)).toBeCloseTo(1.1759);
  });

  it("falls back to 1 for a zero-width page", () => {
    expect(pageScale(700, 0)).toBe(1);
  });
});

describe("pageRenderedHeight", () => {
  it("preserves the aspect ratio", () => {
    // A4 portrait at 700px wide.
    expect(pageRenderedHeight(595.28, 841.89, 700)).toBeCloseTo(989.99);
  });

  it("is 0 for a zero-width page", () => {
    expect(pageRenderedHeight(0, 841.89, 700)).toBe(0);
  });
});

describe("clientToPagePoint", () => {
  it("maps a viewport point into page points, both axes at the same scale", () => {
    // Page box at (100, 50), 600px wide -> 300pt page means scale 2 px/pt.
    const rect = { left: 100, top: 50, width: 600 };
    expect(clientToPagePoint(rect, 300, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToPagePoint(rect, 300, 400, 250)).toEqual({ x: 150, y: 100 });
  });
});

describe("scrollTopForPageY", () => {
  it("brings a page point to the scroller top, minus the margin", () => {
    // Page rendered at scale 2 (600px / 300pt), 40px below the scroller top,
    // which is itself scrolled 1000px down. Target y = 100pt -> 200px into the page.
    const page = { left: 0, top: 90, width: 600 };
    const scroller = { left: 0, top: 50, width: 800 };
    // 1000 (scrollTop) + 40 (page top within scroller) + 200 (100pt * 2) - 16 (margin)
    expect(scrollTopForPageY(page, scroller, 1000, 300, 100, 16)).toBe(1224);
  });

  it("defaults the margin to 0", () => {
    const page = { left: 0, top: 50, width: 600 };
    const scroller = { left: 0, top: 50, width: 800 };
    expect(scrollTopForPageY(page, scroller, 0, 300, 0)).toBe(0);
  });
});
