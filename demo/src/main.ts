import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  createTypstShikiExtension,
  TypstService,
  toCMDiagnostic,
} from "@vedivad/codemirror-typst";
import { basicSetup } from "codemirror";
import { updateDiagnostics } from "./diagnostics";

// --- File contents ---

const files: Record<string, string> = {
  "/main.typ": `\
#import "template.typ": greet

#greet("World")

= Introduction

This demo shows *multi-file* compilation.
Each file is editable — switch tabs to see both.
`,
  "/template.typ": `\
#let greet(name) = {
  align(center, text(24pt, weight: "bold")[
    Hello, #name!
  ])
}
`,
};

// --- Service setup ---

const diagnosticsEl = document.getElementById("diagnostics")!;
const previewEl = document.getElementById("preview")!;
const editorEl = document.getElementById("editor")!;
const tabsEl = document.getElementById("tabs")!;

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => {
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    },
  },
});

// --- Compilation ---

let compileTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCompile() {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(doCompile, 150);
}

async function doCompile() {
  try {
    const result = await service.compile(files);
    updateDiagnostics(diagnosticsEl, []);

    if (activeView) {
      const state = activeView.state;
      const cmDiags = result.diagnostics
        .filter((d) => d.path === activeFile)
        .map((d) => toCMDiagnostic(state, d));
      updateDiagnostics(diagnosticsEl, cmDiags);
      activeView.dispatch(setDiagnostics(state, cmDiags));
    }
  } catch (err) {
    console.error("Compile failed:", err);
  }
}

// --- Editor ---

const shikiExtension = await createTypstShikiExtension({
  themes: { light: "github-light", dark: "github-dark" },
  defaultColor: "dark",
  engine: "javascript",
});

const onChangePlugin = ViewPlugin.define(() => ({
  update(update) {
    if (update.docChanged) {
      files[activeFile] = update.state.doc.toString();
      scheduleCompile();
    }
  },
}));

const sharedExtensions = [
  basicSetup,
  oneDark,
  shikiExtension,
  lintGutter(),
  onChangePlugin,
];

// Store an EditorState per file
const states: Record<string, EditorState> = {};
for (const [path, content] of Object.entries(files)) {
  states[path] = EditorState.create({
    doc: content,
    extensions: sharedExtensions,
  });
}

let activeFile = "/main.typ";
let activeView: EditorView | null = null;

function switchTab(path: string) {
  if (activeView) {
    // Save current state
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

  renderTabs();
}

// --- Tabs ---

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const path of Object.keys(files)) {
    const tab = document.createElement("button");
    tab.className = `tab${path === activeFile ? " active" : ""}`;
    tab.textContent = path.replace(/^\//, "");
    tab.onclick = () => switchTab(path);
    tabsEl.appendChild(tab);
  }
}

// --- Init ---

switchTab("/main.typ");
scheduleCompile();
