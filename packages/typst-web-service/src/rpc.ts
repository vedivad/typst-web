// Injected at build time by tsup (see tsup.config.ts)
declare const __WORKER_CODE__: string;
declare const __ANALYZER_WORKER_CODE__: string;

/** Create a Worker from an inlined code string, auto-revoking the blob URL on terminate. */
export function createBlobWorker(code: string): Worker {
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const origTerminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    origTerminate();
    URL.revokeObjectURL(url);
  };
  return worker;
}

/** Create a blob Worker from the inlined compiler worker code. */
export function createWorker(): Worker {
  return createBlobWorker(__WORKER_CODE__);
}

/** Create a blob Worker from the inlined analyzer worker code. */
export function createAnalyzerWorker(): Worker {
  return createBlobWorker(__ANALYZER_WORKER_CODE__);
}

/** Generic RPC helper: post a message to a worker and await a response matched by id. */
export function workerRpc<
  TReq extends { id: number },
  TRes extends { id: number },
>(
  worker: Worker,
  request: TReq,
  timeoutMs: number = 30_000,
  transfer?: Transferable[],
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<TRes>) => {
      if (e.data.id !== request.id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", handler);
      resolve(e.data);
    };
    const timer = setTimeout(() => {
      worker.removeEventListener("message", handler);
      reject(new Error(`worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    worker.addEventListener("message", handler);
    worker.postMessage(request, transfer ?? []);
  });
}

/** Convenience: send a destroy RPC and terminate the worker. */
export function destroyWorker<TReq extends { id: number }>(
  worker: Worker,
  request: TReq,
  timeoutMs: number,
  label: string,
): void {
  workerRpc(worker, request, timeoutMs)
    .catch((err) => console.error(`${label} destroy failed:`, err))
    .finally(() => worker.terminate());
}
