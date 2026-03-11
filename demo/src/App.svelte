<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import DiagnosticsPanel from './DiagnosticsPanel.svelte';
  import PreviewPanel from './PreviewPanel.svelte';
  import { TypstService } from 'codemirror-typst-linter';
  import type { Diagnostic } from '@codemirror/lint';

  const initialDoc = `\
// Package imports are fetched on demand from packages.typst.org.
// Try introducing errors — squiggles appear instantly.
#import "@preview/cetz:0.3.4": canvas, draw

#canvas({
  draw.circle((0, 0), radius: 1)
  draw.line((0, 0), (1, 0))
})

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

  let diagnostics = $state<Diagnostic[]>([]);
  let pdfUrl = $state<string | null>(null);
  let renderError = $state<string | null>(null);
  let ready = $state(false);
  let service: TypstService | null = null;

  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPdfUrl: string | null = null;

  onMount(() => {
    const s = new TypstService(
      new Worker(new URL('codemirror-typst-linter/worker', import.meta.url), { type: 'module' }),
    );
    service = s;
    ready = true;
    scheduleRender(initialDoc);
    return () => {
      s.destroy();
      if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
    };
  });

  function scheduleRender(source: string) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => render(source), 500);
  }

  async function render(source: string) {
    if (!service) return;
    try {
      const pdf = await service.renderPdf(source);
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
      currentPdfUrl = url;
      pdfUrl = url;
      renderError = null;
    } catch (err) {
      renderError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="layout">
  <header>
    <h1>codemirror-typst-linter</h1>
    <p>Typst diagnostics with incremental compilation and @preview/ package support.</p>
  </header>
  <div class="main">
    {#if ready && service}
      <Editor
        {initialDoc}
        {service}
        onDiagnostics={(d) => { diagnostics = d; }}
        onSourceChange={(src) => scheduleRender(src)}
      />
    {/if}
    <DiagnosticsPanel {diagnostics} />
    <PreviewPanel {pdfUrl} error={renderError} />
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: system-ui, sans-serif;
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .layout {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  header {
    padding: 1rem 1.5rem 0.75rem;
    border-bottom: 1px solid #333;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
    font-family: monospace;
    color: #7ecfff;
  }

  header p {
    margin: 0;
    font-size: 0.85rem;
    color: #888;
  }

  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
</style>
