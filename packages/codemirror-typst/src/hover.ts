import { forEachDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { TypstProject } from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";

export interface TypstHoverOptions {
  project: TypstProject;
}

/**
 * Create a CM6 hover tooltip extension backed by a TypstProject. The editor's
 * current buffer is synced to the engine VFS as part of the request.
 *
 * typsten's `Hover` (from `typst-ide`) is one of two plain shapes: a `code`
 * snippet (a Typst signature/value) or a `text` sentence. The code snippet is
 * syntax-highlighted via the same typst-syntax engine as the editor, so it
 * shares the `typ-*` token palette; the text is plain (not markdown - that was
 * a tinymist-era artifact) and rendered verbatim.
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
      if (!result || !result.value.trim()) return null;
      // Highlight a code snippet up front (async); prose is set as plain text.
      const codeHtml =
        result.kind === "code"
          ? `<pre class="cm-typst-hover-code">${await options.project.highlightHtml(result.value)}</pre>`
          : undefined;
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-typst-hover";
          if (codeHtml !== undefined) dom.innerHTML = codeHtml;
          else dom.textContent = result.value;
          return { dom };
        },
      };
    } catch (err) {
      console.debug("[typst] hover request failed", { path, pos, error: err });
      return null;
    }
  });
}
