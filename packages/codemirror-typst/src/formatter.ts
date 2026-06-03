import type { Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { TypstProject } from "@vedivad/typst-web-service";
import { typstFilePath } from "./facets.js";

export interface DiffChange {
  from: number;
  to: number;
  insert: string;
}

export interface TypstFormatterOptions {
  /** Project whose engine formats the active file. */
  project: TypstProject;
  /** Keybinding for format. Default: "Shift-Alt-f". */
  keybinding?: string;
  /**
   * Format on Ctrl+S / Cmd+S. `true` to format; a function to format then
   * receive the formatted content; omit/`false` to disable.
   */
  formatOnSave?: boolean | ((content: string) => void);
  /** Called when formatting fails. Defaults to `console.warn`. */
  onError?: (error: Error) => void;
}

function handleError(error: unknown, onError?: (error: Error) => void): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (onError) onError(err);
  else console.warn("[typst-formatter]", err.message);
}

/** Minimal change between two strings via common prefix/suffix, to preserve cursor/undo. */
export function diffChanges(oldStr: string, newStr: string): DiffChange[] {
  let from = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (from < minLen && oldStr[from] === newStr[from]) from++;

  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (
    oldEnd > from &&
    newEnd > from &&
    oldStr[oldEnd - 1] === newStr[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  if (from === oldEnd && from === newEnd) return [];
  return [{ from, to: oldEnd, insert: newStr.slice(from, newEnd) }];
}

async function runFormat(
  view: EditorView,
  project: TypstProject,
  onFormatted?: () => void,
  onError?: (error: Error) => void,
): Promise<void> {
  try {
    const path = view.state.facet(typstFilePath);
    const doc = view.state.doc.toString();
    const formatted = await project.format(path, doc);
    // `undefined` means the source can't be formatted (e.g. syntax errors).
    if (formatted === undefined) return;
    // Bail if the document changed while we were awaiting.
    if (view.state.doc.toString() !== doc) return;
    const changes = diffChanges(doc, formatted);
    if (changes.length > 0) view.dispatch({ changes });
    onFormatted?.();
  } catch (error) {
    handleError(error, onError);
  }
}

/**
 * CodeMirror extension that formats the active Typst file via the project's
 * engine. Binds Shift+Alt+F (and optionally Ctrl/Cmd+S). Formats the whole
 * document (typsten has no range formatter).
 */
export function createTypstFormatter(
  options: TypstFormatterOptions,
): Extension {
  const {
    project,
    keybinding = "Shift-Alt-f",
    formatOnSave,
    onError,
  } = options;
  const onSaveFormatted =
    typeof formatOnSave === "function" ? formatOnSave : undefined;

  const keys = [
    {
      key: keybinding,
      run: (view: EditorView) => {
        void runFormat(view, project, undefined, onError);
        return true;
      },
    },
  ];

  if (formatOnSave) {
    keys.push({
      key: "Mod-s",
      run: (view: EditorView) => {
        void runFormat(
          view,
          project,
          onSaveFormatted
            ? () => onSaveFormatted(view.state.doc.toString())
            : undefined,
          onError,
        );
        return true;
      },
    });
  }

  return keymap.of(keys);
}
