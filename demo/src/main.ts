import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstHighlighting,
  createTypstSetup,
  TypstProject,
  typstFilePath,
} from "@vedivad/codemirror-typst";
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

// --- Typst engine (one wasm) ---

const project = await TypstProject.create({
  autoCompile: { debounceMs: 100, maxWaitMs: 500 },
});
await project.setMany(files);
await project.compile(); // trigger the initial compile immediately

// --- Editor state ---

let activeFile = project.files[0];
let activeView: EditorView | null = null;
let colorTheme: "light" | "dark" = "light";

// --- Compile results → preview + diagnostics panel ---

project.onCompile(async (result) => {
  updateDiagnostics(diagnosticsEl, result.diagnostics);
  // Render every page (a real app would render only the visible range).
  const pages = await project.renderedPages(0, result.pages.length);
  previewEl.innerHTML = `<div class="svg-container">${pages
    .map(
      (page) =>
        `<div class="svg-page" data-page="${page.index + 1}">${page.svg}</div>`,
    )
    .join("")}</div>`;
});

// --- Editor extensions ---

const highlighting = await createTypstHighlighting({
  themes: { light: "github-light", dark: "github-dark-dimmed" },
  theme: colorTheme,
});
const typstSetup = createTypstSetup({
  project,
  sync: "editor-driven",
  highlighting,
  formatter: { formatOnSave: true },
});

const editorTheme = new Compartment();
const sharedExtensions = [basicSetup, editorTheme.of([]), ...typstSetup];

function syncTheme(view: EditorView) {
  document.documentElement.dataset.theme = colorTheme;
  themeToggleBtn.textContent = colorTheme === "dark" ? "Dark" : "Light";
  themeToggleBtn.setAttribute("aria-pressed", String(colorTheme === "dark"));
  view.dispatch({
    effects: editorTheme.reconfigure(colorTheme === "dark" ? oneDark : []),
  });
  highlighting.setTheme(view, colorTheme);
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

// --- Init ---

switchTab(activeFile);
