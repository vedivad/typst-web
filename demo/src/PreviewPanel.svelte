<script lang="ts">
  interface Props {
    pdfUrl: string | null;
    error: string | null;
  }

  let { pdfUrl, error }: Props = $props();
</script>

<div class="preview">
  {#if error}
    <div class="error">{error}</div>
  {:else if pdfUrl}
    <iframe src={pdfUrl} title="Typst preview"></iframe>
  {:else}
    <div class="placeholder">Rendering…</div>
  {/if}
</div>

<style>
  .preview {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid #333;
    background: #fff;
  }

  iframe {
    flex: 1;
    border: none;
    width: 100%;
    height: 100%;
  }

  .error {
    padding: 1rem;
    color: #ff6b6b;
    font-size: 0.8rem;
    font-family: monospace;
    white-space: pre-wrap;
    background: #1a1a2e;
    height: 100%;
    overflow: auto;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    font-size: 0.85rem;
    background: #1a1a2e;
  }
</style>
