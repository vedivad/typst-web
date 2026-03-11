<script lang="ts">
  import Editor from './Editor.svelte';
  import DiagnosticsPanel from './DiagnosticsPanel.svelte';
  import type { Diagnostic } from '@codemirror/lint';

  const initialDoc = `\
// Try introducing errors below — squiggles appear instantly.
#let greeting(name) = [Hello, #name!]

#greeting("World")

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

  let diagnostics = $state<Diagnostic[]>([]);
</script>

<div class="layout">
  <header>
    <h1>codemirror-typst-linter</h1>
    <p>Typst diagnostics with incremental compilation. Edit the document to see errors highlighted in real time.</p>
  </header>
  <div class="main">
    <Editor {initialDoc} onDiagnostics={(d) => { diagnostics = d; }} />
    <DiagnosticsPanel {diagnostics} />
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
