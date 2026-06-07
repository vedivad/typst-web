// Geometry for SVG page previews: converts between viewport pixels and page
// point coordinates (the SVG viewBox unit and `RenderedSvgPage.width/height`).
// Pure geometry, the preview counterpart of `coords.ts`. A single scale
// (rendered width / point width) maps both axes because Typst preserves aspect
// ratio. `PreviewNavigator` composes these into click-to-jump navigation.

/** The subset of `DOMRect` these helpers read. `el.getBoundingClientRect()`
 *  satisfies it at runtime; a plain object works in tests. */
export interface Rect {
  left: number;
  top: number;
  width: number;
}

/** CSS pixels per typst point for a page rendered `renderedWidthPx` wide,
 *  where `pageWidthPt` is `RenderedSvgPage.width`. Falls back to 1 for zero-width pages. */
export function pageScale(
  renderedWidthPx: number,
  pageWidthPt: number,
): number {
  return pageWidthPt > 0 ? renderedWidthPx / pageWidthPt : 1;
}

/** Rendered height in CSS px of a page laid out `renderedWidthPx` wide,
 *  from its point dimensions. Used for fit-to-height and visibility checks. */
export function pageRenderedHeight(
  pageWidthPt: number,
  pageHeightPt: number,
  renderedWidthPx: number,
): number {
  return pageWidthPt > 0 ? (renderedWidthPx * pageHeightPt) / pageWidthPt : 0;
}

/** Maps a viewport point to page point coordinates given the page's
 *  on-screen rect and `RenderedSvgPage.width`. Inverse of SVG layout,
 *  e.g. to pass a click to `clickJump`. */
export function clientToPagePoint(
  pageRect: Rect,
  pageWidthPt: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const scale = pageScale(pageRect.width, pageWidthPt);
  return {
    x: (clientX - pageRect.left) / scale,
    y: (clientY - pageRect.top) / scale,
  };
}

/** Returns the `scrollTop` that places `yPt` points from a page's top at
 *  `margin` px below the scroller's top edge. Pass page and scroller
 *  `getBoundingClientRect()`s and the scroller's current `scrollTop`. */
export function scrollTopForPageY(
  pageRect: Rect,
  scrollerRect: Rect,
  scrollerScrollTop: number,
  pageWidthPt: number,
  yPt: number,
  margin = 0,
): number {
  const scale = pageScale(pageRect.width, pageWidthPt);
  return (
    scrollerScrollTop + (pageRect.top - scrollerRect.top) + yPt * scale - margin
  );
}
