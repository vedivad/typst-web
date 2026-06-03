import type { HighlightStyle, TagStyle } from "@codemirror/language";
import { type Tag, tags } from "@lezer/highlight";
import type { TokenTheme } from "./highlight.js";

// Map each Typst `typ-*` highlight class (see `Tag::css_class` in typsten) to the
// standard @lezer/highlight tags a CodeMirror theme would color, in priority
// order (first match wins). This is the bridge that lets any ecosystem
// `HighlightStyle` drive Typst highlighting, instead of hand-writing a palette
// per theme. Some Typst tags have no exact Lezer equivalent (math operators,
// interpolation), so they borrow the closest generic tag.
const TYP_TO_TAG: Record<string, readonly Tag[]> = {
  "typ-comment": [tags.lineComment, tags.comment],
  "typ-punct": [tags.punctuation],
  "typ-escape": [tags.escape],
  "typ-strong": [tags.strong],
  "typ-emph": [tags.emphasis],
  "typ-link": [tags.url, tags.link],
  "typ-raw": [tags.monospace, tags.literal],
  "typ-label": [tags.labelName],
  "typ-ref": [tags.labelName, tags.name],
  "typ-heading": [tags.heading],
  "typ-marker": [tags.list, tags.punctuation],
  "typ-term": [tags.strong],
  "typ-math-delim": [tags.bracket, tags.punctuation],
  "typ-math-op": [tags.operator],
  "typ-key": [tags.keyword],
  "typ-op": [tags.operator],
  "typ-num": [tags.number],
  "typ-str": [tags.string],
  "typ-func": [tags.function(tags.variableName), tags.variableName],
  "typ-pol": [tags.special(tags.variableName), tags.variableName],
};

// The CSS-in-JS declarations of a tag style, minus the non-style keys.
function styleOf(spec: TagStyle): Record<string, string> {
  const css: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (key !== "tag" && key !== "class" && typeof value === "string") {
      css[key] = value;
    }
  }
  return css;
}

/**
 * Derive a Typst `typ-*` {@link TokenTheme} from a CodeMirror
 * {@link HighlightStyle} (or its raw `TagStyle[]` specs, the form `@uiw` themes
 * export). It reads the specs directly (no CSS parsing, no `@media` surprises),
 * mapping each Typst token class to the first of its candidate @lezer/highlight
 * tags the style defines. This opens the whole CodeMirror theme ecosystem to
 * Typst for free:
 *
 * ```ts
 * import { githubDarkStyle } from "@uiw/codemirror-theme-github";
 * // beside typstHighlighting({ project }), in a Compartment you can swap:
 * typstTheme(githubDarkStyle);
 * ```
 *
 * {@link typstTheme} calls this for you when handed a `HighlightStyle`. Tags the
 * style leaves unstyled fall through to the editor's default text color.
 */
export function tokenThemeFromHighlightStyle(
  style: HighlightStyle | readonly TagStyle[],
): TokenTheme {
  // Accept a constructed HighlightStyle (CM core, one-dark) or its raw specs
  // (what `@uiw` themes export as `xStyle`).
  const specs = Array.isArray(style) ? style : (style as HighlightStyle).specs;
  // First spec for a tag wins, matching CodeMirror's own precedence.
  const byTag = new Map<Tag, Record<string, string>>();
  for (const spec of specs) {
    const css = styleOf(spec);
    const specTags = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
    for (const tag of specTags) if (!byTag.has(tag)) byTag.set(tag, css);
  }

  const theme: TokenTheme = {};
  for (const [cls, candidates] of Object.entries(TYP_TO_TAG)) {
    for (const tag of candidates) {
      const css = byTag.get(tag);
      if (css) {
        theme[`.${cls}`] = css;
        break;
      }
    }
  }
  return theme;
}
