// The typsten worker code is inlined at build time by tsup (see tsup.config.ts)
// as an IIFE bundle, so consumers get a self-contained worker with no extra
// bundler setup. The wasm itself is loaded from a URL passed to `init()`.
declare const __WORKER_CODE__: string;

/** Create a Worker from inlined code, auto-revoking the blob URL on terminate. */
export function createWorker(): Worker {
  const blob = new Blob([__WORKER_CODE__], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const origTerminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    origTerminate();
    URL.revokeObjectURL(url);
  };
  return worker;
}
