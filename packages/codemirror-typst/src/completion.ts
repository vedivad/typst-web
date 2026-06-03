import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
} from "@codemirror/autocomplete";
import {
  byteToCmOffset,
  type CompletionKind,
  type CompletionResponse,
  type TypstProject,
} from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";

export interface TypstCompletionOptions {
  project: TypstProject;
}

/** typsten CompletionKind -> CM6 completion `type`. */
const KIND_TO_TYPE: Record<CompletionKind, string> = {
  syntax: "keyword",
  func: "function",
  type: "type",
  param: "property",
  constant: "constant",
  path: "text",
  package: "namespace",
  label: "text",
  font: "text",
  symbol: "constant",
};

/**
 * Translate typsten/typst-ide snippet syntax (`${name}` placeholders) into CM6
 * template syntax (`#{name}`), escaping literal `#` in the surrounding text.
 */
function typstSnippetToCMTemplate(apply: string): string {
  return apply.replace(/#/g, "\\#").replace(/\$\{([^}]*)\}/g, "#{$1}");
}

function toCM(
  source: string,
  result: CompletionResponse,
): CompletionResult | null {
  if (!result.completions.length) return null;
  const from = byteToCmOffset(source, result.from);
  const options: Completion[] = result.completions.map((c) => ({
    label: c.label,
    type: KIND_TO_TYPE[c.kind],
    detail: c.detail ?? undefined,
    apply:
      c.apply !== undefined && c.apply.includes("${")
        ? snippet(typstSnippetToCMTemplate(c.apply))
        : (c.apply ?? c.label),
  }));
  return { from, options, validFor: /^[#\w.-]*$/ };
}

/**
 * Create a CM6 CompletionSource backed by a TypstProject. The editor's current
 * buffer is synced to the engine VFS as part of the request, so completions
 * reflect the latest text.
 */
export function typstCompletionSource(
  options: TypstCompletionOptions,
): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (!ctx.explicit && !ctx.matchBefore(/[#\w.]/)) return null;

    const path = ctx.state.facet(typstFilePath);
    const source = ctx.state.doc.toString();

    try {
      const result = await options.project.completion(
        path,
        source,
        ctx.pos,
        ctx.explicit,
      );
      if (!result) return null;
      return toCM(source, result);
    } catch (err) {
      console.debug("[typst] completion request failed", { path, error: err });
      return null;
    }
  };
}
