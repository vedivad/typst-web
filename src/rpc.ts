import type { WorkerRequest, WorkerResponse } from "./types.js";

declare const __WORKER_CODE__: string;

export function createWorker(): Worker {
  const blob = new Blob([__WORKER_CODE__], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

export function workerRpc(
  worker: Worker,
  request: WorkerRequest,
  timeoutMs = 30_000,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id === request.id) {
        clearTimeout(timer);
        worker.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    const timer = setTimeout(() => {
      worker.removeEventListener("message", handler);
      reject(new Error(`typstLinter: worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    worker.addEventListener("message", handler);
    worker.postMessage(request);
  });
}
