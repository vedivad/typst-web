import { TypstService } from 'codemirror-typst';
import { createEditor } from './editor';
import { updateDiagnostics } from './diagnostics';

const editorEl = document.getElementById('editor')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const previewEl = document.getElementById('preview')!;

const service = new TypstService(
  new Worker(new URL('typst-web-service/worker', import.meta.url), { type: 'module' }),
  {
    renderer: () => import('@myriaddreamin/typst-ts-renderer'),
    onSvg: (svg) => {
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    },
  },
);

createEditor(editorEl, service, (d) => updateDiagnostics(diagnosticsEl, d));
