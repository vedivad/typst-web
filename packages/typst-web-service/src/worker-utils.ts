/** Post a formatted error message back to the main thread. */
export function postError(id: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  self.postMessage({ type: "error", id, message });
}
