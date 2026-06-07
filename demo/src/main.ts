import { EditorState } from "@codemirror/state";
import {
  githubDark,
  githubDarkStyle,
  githubLight,
  githubLightStyle,
} from "@uiw/codemirror-theme-github";
import {
  createTypstSetup,
  TypstProject,
  typstFilePath,
  typstThemes,
} from "@vedivad/codemirror-typst";
import { pageScale, PreviewNavigator } from "@vedivad/typst-web-service";
import { basicSetup, EditorView } from "codemirror";
import { updateDiagnostics } from "./diagnostics";
import { files } from "./files";
import { type AddFileResult, renderTabs, showNewFileInput } from "./tabs";

// --- DOM refs ---

const diagnosticsEl = document.getElementById("diagnostics")!;
const previewEl = document.getElementById("preview")!;
const editorEl = document.getElementById("editor")!;
const tabsEl = document.getElementById("tabs")!;
const themeToggleBtn = document.getElementById(
  "theme-toggle",
) as HTMLButtonElement;
const exportPdfBtn = document.getElementById("export-pdf") as HTMLButtonElement;

// --- Typst engine ---

const project = await TypstProject.create({
  autoCompile: { debounceMs: 100, maxWaitMs: 500 },
});
await project.setMany(files);
await project.compile(); // trigger the initial compile immediately

// --- Editor state ---

let activeFile = project.files[0];
let activeView: EditorView | null = null;
let colorTheme: "light" | "dark" = "light";

// --- Compile results -> preview + diagnostics panel ---

// Drives click navigation: text jumps to its editor source, while internal links
// (scroll) and URLs (open) use the built-in defaults. The view reads the page
// <svg>s live, so rendering just sets innerHTML with nothing to register.
const navigator = PreviewNavigator.create({
  project,
  scroller: previewEl,
  pages: () => previewEl.querySelectorAll(".svg-page"),
  onSource: jumpToSource,
  margin: 16,
});

project.onCompile(async (result) => {
  updateDiagnostics(diagnosticsEl, result.diagnostics);
  const pages = await project.renderedPages(0, result.pages.length);
  previewEl.innerHTML = pages
    .map((page) => `<div class="svg-page">${page.svg}</div>`)
    .join("");
});

// --- Editor extensions ---

// A light/dark selection from the GitHub themes (chrome + token HighlightStyle
// via the lezer-tag bridge), bound into the setup and toggled in syncTheme().
const theme = typstThemes(
  {
    light: { editor: githubLight, tokens: githubLightStyle },
    dark: { editor: githubDark, tokens: githubDarkStyle },
  },
  "light",
);

const typstSetup = createTypstSetup({
  project,
  sync: "editor-driven",
  theme: theme.extension,
  formatter: { formatOnSave: true },
});

// Opt-in: Ctrl/Cmd+click in the editor centers the preview on the source position
// and flashes a circle there, without interfering with normal scrolling.
const revealInPreview = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
    const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (offset == null) return false;
    void navigator
      .scrollToSource(
        view.state.facet(typstFilePath),
        view.state.doc.toString(),
        offset,
        { align: "center" },
      )
      .then((at) => {
        if (at) flashReveal(at.page, at.x, at.y);
      });
    return false; // let CodeMirror place the cursor as usual
  },
});

// Flash a circle at a page point, anchored in the page element so it stays put during scroll.
function flashReveal(page: number, xPt: number, yPt: number) {
  const pageEl = previewEl.querySelectorAll<HTMLElement>(".svg-page")[page];
  const svg = pageEl?.querySelector("svg");
  if (!pageEl || !svg) return;
  const scale = pageScale(
    svg.getBoundingClientRect().width,
    svg.viewBox.baseVal.width,
  );
  const dot = document.createElement("div");
  dot.className = "reveal-dot";
  // jump_from_cursor returns the baseline-left origin; lift to sit on the glyphs.
  const LIFT_PT = 5;
  dot.style.left = `${xPt * scale}px`;
  dot.style.top = `${(yPt - LIFT_PT) * scale}px`;
  dot.addEventListener("animationend", () => {
    dot.remove();
  });
  pageEl.append(dot);
}

const sharedExtensions = [basicSetup, ...typstSetup, revealInPreview];

function syncTheme(view: EditorView) {
  document.documentElement.dataset.theme = colorTheme;
  themeToggleBtn.textContent = colorTheme === "dark" ? "Dark" : "Light";
  themeToggleBtn.setAttribute("aria-pressed", String(colorTheme === "dark"));
  theme.set(view, colorTheme);
}

const states: Record<string, EditorState> = Object.fromEntries(
  project.files.map((path) => [
    path,
    EditorState.create({
      doc: project.getText(path) ?? "",
      extensions: [...sharedExtensions, typstFilePath.of(path)],
    }),
  ]),
);

// --- Tab switching ---

function switchTab(path: string) {
  if (activeView) {
    states[activeFile] = activeView.state;
  }

  activeFile = path;

  if (activeView) {
    activeView.setState(states[path]);
  } else {
    activeView = new EditorView({
      state: states[path],
      parent: editorEl,
    });
  }

  syncTheme(activeView);
  rerenderTabs();
}

// Move the cursor to a 1-based line/column in `file`, switching tabs first.
function jumpToSource(file: string, line: number, column: number) {
  if (!project.files.includes(file)) return;
  if (activeFile !== file) switchTab(file);
  const view = activeView;
  if (!view) return;
  const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines));
  const pos = Math.min(docLine.from + (column - 1), docLine.to);
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}

function rerenderTabs() {
  renderTabs({
    root: tabsEl,
    paths: project.files,
    activeFile,
    onSelect: switchTab,
    onClose: removeFile,
    onAdd: () => showNewFileInput({ root: tabsEl, onConfirm: addFile }),
  });
}

// --- File management ---

async function addFile(rawName: string): Promise<AddFileResult> {
  let path = rawName.trim();
  if (!path) return { ok: false, error: "Name required" };
  if (!path.endsWith(".typ")) path += ".typ";
  if (!path.startsWith("/")) path = "/" + path;
  if (project.files.includes(path)) {
    return { ok: false, error: `"${path}" already exists` };
  }

  await project.setText(path, "");
  states[path] = EditorState.create({
    doc: "",
    extensions: [...sharedExtensions, typstFilePath.of(path)],
  });
  switchTab(path);
  return { ok: true };
}

async function removeFile(path: string) {
  const paths = project.files;
  if (paths.length <= 1) return; // must keep at least one file
  const idx = paths.indexOf(path);
  delete states[path];
  await project.remove(path);
  if (activeFile === path) {
    const remaining = project.files;
    switchTab(remaining[Math.max(0, idx - 1)]);
  } else {
    rerenderTabs();
  }
}

themeToggleBtn.addEventListener("click", () => {
  colorTheme = colorTheme === "dark" ? "light" : "dark";
  if (activeView) {
    syncTheme(activeView);
  }
});

exportPdfBtn.addEventListener("click", async () => {
  exportPdfBtn.disabled = true;
  try {
    const pdf = await project.exportPdf();
    if (!pdf) return; // nothing compiled yet
    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeFile.replace(/^\//, "").replace(/\.typ$/, ".pdf");
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    exportPdfBtn.disabled = false;
  }
});

// --- Init ---

switchTab(activeFile);
