import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import type { TypstFormatter } from "@vedivad/typst-web-service";

export interface TypstFormatterOptions {
  /** TypstFormatter instance to use for formatting. */
  formatter: TypstFormatter;
  /** Keybinding for format. Default: "Shift-Alt-f" */
  keybinding?: string;
  /**
   * Format the document on Ctrl+S / Cmd+S.
   *
   * - `true` — format on save, no callback.
   * - A function — format on save, then call the function with the formatted content.
   *
   * Omit or set to `false` to disable.
   */
  formatOnSave?: boolean | ((content: string) => void);
}

async function formatDocument(
  view: EditorView,
  formatter: TypstFormatter,
): Promise<void> {
  const doc = view.state.doc.toString();
  const formatted = await formatter.format(doc);
  if (formatted !== doc) {
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: formatted },
    });
  }
}

async function formatAsync(
  view: EditorView,
  formatter: TypstFormatter,
): Promise<void> {
  const { from, to } = view.state.selection.main;

  if (from !== to) {
    const doc = view.state.doc.toString();
    const result = await formatter.formatRange(doc, from, to);
    view.dispatch({
      changes: { from: result.start, to: result.end, insert: result.text },
    });
  } else {
    await formatDocument(view, formatter);
  }
}

async function formatAndSave(
  view: EditorView,
  formatter: TypstFormatter,
  onSave: boolean | ((content: string) => void),
): Promise<void> {
  await formatDocument(view, formatter);
  if (typeof onSave === "function") {
    onSave(view.state.doc.toString());
  }
}

/**
 * Create a CodeMirror extension that formats Typst code via a TypstFormatter.
 *
 * Binds Shift+Alt+F by default. Formats the selection if one exists,
 * otherwise formats the entire document.
 *
 * When `formatOnSave` is enabled, Ctrl+S / Cmd+S formats the full document
 * and optionally calls a callback with the formatted content.
 */
export function createTypstFormatter(
  options: TypstFormatterOptions,
): Extension {
  const { formatter, keybinding = "Shift-Alt-f", formatOnSave } = options;

  const keys = [
    {
      key: keybinding,
      run: (view: EditorView) => {
        formatAsync(view, formatter);
        return true;
      },
    },
  ];

  if (formatOnSave) {
    keys.push({
      key: "Mod-s",
      run: (view: EditorView) => {
        formatAndSave(view, formatter, formatOnSave);
        return true;
      },
    });
  }

  return keymap.of(keys);
}
