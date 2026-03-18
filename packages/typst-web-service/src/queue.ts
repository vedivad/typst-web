const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Creates a coalescing async queue. When multiple requests arrive while one is
 * being processed, only the latest is kept — earlier ones are cancelled.
 *
 * This is useful for debouncing expensive operations (e.g. WASM compilation)
 * where only the most recent request matters.
 *
 * @param handle  Called with each request that isn't cancelled.
 * @param onCancel  Called with each request that was superseded before processing.
 */
export function makeQueue<T extends { id: number }>(
  handle: (req: T) => Promise<void>,
  onCancel?: (req: T) => void,
): (req: T) => void {
  let pending: T | null = null;
  let processing = false;

  async function drain(): Promise<void> {
    processing = true;
    while (pending) {
      const req = pending;
      pending = null;
      await yieldToEventLoop();
      if (pending) {
        onCancel?.(req);
        continue;
      }
      try {
        await handle(req);
      } catch {
        // Handler is responsible for its own error reporting.
        // Swallow here so the queue keeps draining.
      }
    }
    processing = false;
  }

  return (req: T) => {
    pending = req;
    if (!processing) drain();
  };
}
