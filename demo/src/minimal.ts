import { EditorState } from "@codemirror/state";
import { createTypstSetup, TypstProject } from "@vedivad/codemirror-typst";
import { basicSetup, EditorView } from "codemirror";

const editorEl = document.getElementById("editor")!;
const previewEl = document.getElementById("preview")!;

const project = await TypstProject.create({
  autoCompile: { debounceMs: 100, maxWaitMs: 500 },
});

project.onCompile(async (result) => {
  if (result.pages.length === 0) return;
  const svg = await project.renderPage(0);
  previewEl.innerHTML = `<div class="svg-container">${svg ?? ""}</div>`;
});

const typstSetup = createTypstSetup({
  project,
  sync: "editor-driven",
});

new EditorView({
  parent: editorEl,
  state: EditorState.create({
    doc: `= Hello, Typst!\n\nType to compile. Errors show in the gutter.\n\n#let greet(name) = [Hello, #name!]\n\n#greet("world")\n`,
    extensions: [basicSetup, ...typstSetup],
  }),
});

await project.compile(); // trigger the initial compile immediately
