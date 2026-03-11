<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { typst } from 'codemirror-lang-typst';
  import { typstLinter, TypstService } from 'codemirror-typst-linter';
  import type { Diagnostic } from '@codemirror/lint';

  interface Props {
    initialDoc: string;
    onDiagnostics: (diagnostics: Diagnostic[]) => void;
  }

  let { initialDoc, onDiagnostics }: Props = $props();

  let container: HTMLDivElement;

  onMount(() => {
    const service = new TypstService(
      new Worker(new URL('codemirror-typst-linter/worker', import.meta.url), { type: 'module' }),
    );

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          oneDark,
          typst(),
          typstLinter(service, { onDiagnostics }),
        ],
      }),
      parent: container,
    });

    return () => {
      view.destroy();
      service.destroy();
    };
  });
</script>

<div class="editor" bind:this={container}></div>

<style>
  .editor {
    flex: 1;
    overflow: hidden;
  }

  :global(.editor .cm-editor) {
    height: 100%;
  }

  :global(.editor .cm-scroller) {
    overflow: auto;
    font-family: 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
    font-size: 14px;
  }
</style>
