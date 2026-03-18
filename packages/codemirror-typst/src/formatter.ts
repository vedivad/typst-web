import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import type { TypstFormatter } from "@vedivad/typst-web-service";

export interface TypstFormatterOptions {
  /** TypstFormatter instance to use for formatting. */
  formatter: TypstFormatter;
  /** Keybinding for format. Default: "Shift-Alt-f" */
  keybinding?: string;
}

async function formatAsync(
  view: EditorView,
  formatter: TypstFormatter,
): Promise<void> {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();

  if (from !== to) {
    const result = await formatter.formatRange(doc, from, to);
    view.dispatch({
      changes: { from: result.start, to: result.end, insert: result.text },
    });
  } else {
    const formatted = await formatter.format(doc);
    if (formatted !== doc) {
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: formatted },
      });
    }
  }
}

/**
 * Create a CodeMirror extension that formats Typst code via a TypstFormatter.
 *
 * Binds Shift+Alt+F by default. Formats the selection if one exists,
 * otherwise formats the entire document.
 */
export function createTypstFormatter(
  options: TypstFormatterOptions,
): Extension {
  const { formatter, keybinding = "Shift-Alt-f" } = options;

  return keymap.of([
    {
      key: keybinding,
      run: (view) => {
        formatAsync(view, formatter);
        return true;
      },
    },
  ]);
}
