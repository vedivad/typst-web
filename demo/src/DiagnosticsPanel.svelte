<script lang="ts">
  import type { Diagnostic } from '@codemirror/lint';

  interface Props {
    diagnostics: Diagnostic[];
  }

  let { diagnostics }: Props = $props();

  function severityIcon(severity: string) {
    if (severity === 'error') return '✕';
    if (severity === 'warning') return '⚠';
    return 'ℹ';
  }
</script>

<aside class="panel">
  <h2>Diagnostics {#if diagnostics.length}<span class="count">{diagnostics.length}</span>{/if}</h2>
  {#if diagnostics.length === 0}
    <p class="empty">No issues found.</p>
  {:else}
    <ul>
      {#each diagnostics as d}
        <li class="diagnostic {d.severity}">
          <span class="icon">{severityIcon(d.severity)}</span>
          <span class="message">{d.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .panel {
    width: 280px;
    border-left: 1px solid #333;
    overflow-y: auto;
    padding: 0.75rem;
    flex-shrink: 0;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }

  .count {
    background: #e5534b;
    color: #fff;
    border-radius: 8px;
    padding: 0.1em 0.5em;
    font-size: 0.75rem;
    margin-left: 0.4em;
  }

  .empty {
    font-size: 0.8rem;
    color: #666;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .diagnostic {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8rem;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
  }

  .diagnostic.error .icon { color: #e5534b; }
  .diagnostic.warning .icon { color: #e09b47; }
  .diagnostic.info .icon { color: #7ecfff; }

  .icon {
    flex-shrink: 0;
    font-size: 0.9rem;
    line-height: 1.3;
  }

  .message {
    line-height: 1.3;
    word-break: break-word;
  }
</style>
