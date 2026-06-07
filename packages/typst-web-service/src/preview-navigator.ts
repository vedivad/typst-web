import type { Path } from "./identifiers.js";
import type { TypstProject } from "./project.js";
import { clientToPagePoint, scrollTopForPageY } from "./preview.js";
import type { ClickJump, CursorJump } from "./types.js";

export interface PreviewNavigatorOptions {
  /** The project whose `clickJump` resolves clicks, or a thunk returning it.
   *  Pass a thunk when the host swaps project instances (e.g. on file change) so
   *  the navigator always reads the current one without being re-created. */
  project: TypstProject | (() => TypstProject);
  /** The scroll container holding the rendered pages. Used to scroll to
   *  destinations and, unless `listen` is false, to delegate click handling. */
  scroller: HTMLElement;
  /** One element per page, in order: each the page's root `<svg>` or a wrapper
   *  containing it. Read live on every event so DOM changes are always reflected.
   *  Holes (`null`) mark absent pages. */
  pages: () => ArrayLike<Element | null | undefined>;
  /** Attach a `click` listener on `scroller` that routes clicks through the
   *  engine. Set false when the host owns pointer handling (drag/pan/snap) and
   *  calls `jumpAt` itself. Default true. */
  listen?: boolean;
  /** A `source` jump: move the editor to `file` at 1-based `line`/`column`. */
  onSource?: (file: string, line: number, column: number) => void;
  /** A `url` jump. Defaults to opening the URL in a new tab. */
  onUrl?: (url: string) => void;
  /** A `position` (internal-link) jump. Defaults to scrolling the destination
   *  into view; override to drive your own scroll/highlight. */
  onPosition?: (page: number, yPt: number) => void;
  /** Px above the destination when scrolling to a `position`. */
  margin?: number;
  /** Scroll behavior for the default `position` handler. Default "smooth". */
  behavior?: ScrollBehavior;
}

export interface PreviewScrollOptions {
  /** Where the target sits in the viewport, like `scrollIntoView`'s `block`:
   *  "start" (top, offset by `margin`), "center", or "end" (bottom, less
   *  `margin`). Default "start". */
  align?: "start" | "center" | "end";
  /** Override the navigator's default scroll behavior for this call. */
  behavior?: ScrollBehavior;
}

/**
 * Drives click-to-jump navigation for a Typst preview without owning rendering
 * or page state. Resolves clicks via `project.clickJump` and routes the result
 * to the editor (`source`), a scroll (`position`), or a URL. `scrollToSource`
 * runs the reverse: editor cursor to preview position.
 *
 *   const preview = PreviewNavigator.create({
 *     project,
 *     scroller,
 *     pages: () => scroller.querySelectorAll(".page"),
 *     onSource,
 *   });
 *   // ...
 *   preview.dispose();
 */
export class PreviewNavigator {
  private readonly onClick?: (e: MouseEvent) => void;

  private constructor(private readonly opts: PreviewNavigatorOptions) {
    if (opts.listen !== false) {
      this.onClick = (e) => {
        e.preventDefault();
        void this.jumpAt(e.clientX, e.clientY);
      };
      opts.scroller.addEventListener("click", this.onClick);
    }
  }

  /** Create a preview view bound to `project` and `scroller`. */
  static create(opts: PreviewNavigatorOptions): PreviewNavigator {
    return new PreviewNavigator(opts);
  }

  /** The 0-based page under a viewport point and the point in that page's own
   *  coordinates (the SVG viewBox unit, what `clickJump` expects), or null when
   *  the point is over no page. */
  pointToPage(
    clientX: number,
    clientY: number,
  ): { page: number; x: number; y: number } | null {
    const pages = this.opts.pages();
    for (let page = 0; page < pages.length; page++) {
      const svg = rootSvg(pages[page]);
      if (!svg) continue;
      const rect = svg.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const { x, y } = clientToPagePoint(
        rect,
        svg.viewBox.baseVal.width,
        clientX,
        clientY,
      );
      return { page, x, y };
    }
    return null;
  }

  /** Resolve a viewport point through the engine and route the resulting jump
   *  (`source` to the editor, `position` to a scroll, `url` to open). No-op when
   *  the point is over no page or the engine finds nothing actionable. */
  async jumpAt(clientX: number, clientY: number): Promise<void> {
    const hit = this.pointToPage(clientX, clientY);
    if (!hit) return;
    let jump: ClickJump | undefined;
    try {
      jump = await this.currentProject().clickJump(hit.page, hit.x, hit.y);
    } catch (err) {
      console.error("[typst] clickJump failed:", err);
      return;
    }
    if (!jump) return;
    if (jump.kind === "source") {
      this.opts.onSource?.(jump.file, jump.line, jump.column);
    } else if (jump.kind === "url") {
      (this.opts.onUrl ?? openInNewTab)(jump.url);
    } else if (this.opts.onPosition) {
      this.opts.onPosition(jump.page, jump.y);
    } else {
      this.scrollToPosition(jump.page, jump.y);
    }
  }

  /** Resolve a CodeMirror `offset` in `path` (with `source` as the live buffer)
   *  to where it renders and scroll there. Returns the position for a highlight,
   *  or null if the cursor maps nowhere. Reverse of `jumpAt`. */
  async scrollToSource(
    path: Path,
    source: string,
    offset: number,
    opts: PreviewScrollOptions = {},
  ): Promise<CursorJump | null> {
    let pos: CursorJump | undefined;
    try {
      pos = await this.currentProject().jumpFromCursor(path, source, offset);
    } catch (err) {
      console.error("[typst] jumpFromCursor failed:", err);
      return null;
    }
    if (!pos) return null;
    this.scrollToPosition(pos.page, pos.y, opts);
    return pos;
  }

  /** The current project, resolving the thunk form of `opts.project`. */
  private currentProject(): TypstProject {
    const { project } = this.opts;
    return typeof project === "function" ? project() : project;
  }

  /** Scroll `yPt` points down page `page` to `opts.align` in the viewport
   *  (default "start", offset by `margin`). Default handler for a `position` jump. */
  scrollToPosition(
    page: number,
    yPt: number,
    opts: PreviewScrollOptions = {},
  ): void {
    const svg = rootSvg(this.opts.pages()[page]);
    if (!svg) return;
    const { scroller } = this.opts;
    const margin = this.opts.margin ?? 0;
    const height = scroller.clientHeight;
    const offsetFromTop =
      opts.align === "center"
        ? height / 2
        : opts.align === "end"
          ? height - margin
          : margin;
    scroller.scrollTo({
      top: scrollTopForPageY(
        svg.getBoundingClientRect(),
        scroller.getBoundingClientRect(),
        scroller.scrollTop,
        svg.viewBox.baseVal.width,
        yPt,
        offsetFromTop,
      ),
      behavior: opts.behavior ?? this.opts.behavior ?? "smooth",
    });
  }

  /** Detach the click listener, if one was attached. */
  dispose(): void {
    if (this.onClick) {
      this.opts.scroller.removeEventListener("click", this.onClick);
    }
  }
}

/** The page's root `<svg>`: the element itself if it is one, else its first
 *  descendant `<svg>` (document order puts the root before any nested image svg). */
function rootSvg(el: Element | null | undefined): SVGSVGElement | null {
  if (!el) return null;
  return el instanceof SVGSVGElement ? el : el.querySelector("svg");
}

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
