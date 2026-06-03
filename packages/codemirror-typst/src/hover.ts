import { forEachDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Hover, TypstProject } from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";
import { type CodeHighlighter, renderHoverMarkdown } from "./hover-markdown.js";

export interface TypstHoverOptions {
  project: TypstProject;
  /** Optional function to syntax-highlight code blocks (code, language) -> HTML. */
  highlightCode?: CodeHighlighter;
}

/** typsten Hover -> markdown: prose is rendered as-is; code as a fenced Typst block. */
function hoverToMarkdown(hover: Hover): string {
  return hover.kind === "code" ? `\`\`\`typst\n${hover.value}\n\`\`\`` : hover.value;
}

/**
 * Create a CM6 hover tooltip extension backed by a TypstProject. The editor's
 * current buffer is synced to the engine VFS as part of the request.
 */
export function createTypstHover(options: TypstHoverOptions): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    // If a lint diagnostic covers this position, let the lint tooltip handle it.
    let hasDiagnostic = false;
    forEachDiagnostic(view.state, (_d, from, to) => {
      if (pos >= from && pos <= to) hasDiagnostic = true;
    });
    if (hasDiagnostic) return null;

    const path = view.state.facet(typstFilePath);
    const source = view.state.doc.toString();

    try {
      const result = await options.project.hover(path, source, pos);
      if (!result) return null;
      const markdown = hoverToMarkdown(result);
      if (!markdown.trim()) return null;
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-typst-hover";
          dom.innerHTML = renderHoverMarkdown(markdown, options.highlightCode);
          dom.style.maxHeight = "26rem";
          dom.style.overflow = "auto";
          return { dom };
        },
      };
    } catch (err) {
      console.debug("[typst] hover request failed", { path, pos, error: err });
      return null;
    }
  });
}
