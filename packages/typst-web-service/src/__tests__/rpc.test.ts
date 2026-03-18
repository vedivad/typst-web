import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "../types.js";
import { workerRpc } from "../rpc.js";

type MessageHandler = (e: MessageEvent<WorkerResponse>) => void;

function createMockWorker() {
  const listeners: MessageHandler[] = [];
  return {
    addEventListener: vi.fn((_, handler: MessageHandler) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_, handler: MessageHandler) => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    postMessage: vi.fn(),
    /** Simulate the worker posting a message back. */
    emit(data: WorkerResponse) {
      for (const handler of [...listeners]) {
        handler({ data } as MessageEvent<WorkerResponse>);
      }
    },
    listeners,
  };
}

describe("workerRpc", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves on matching message id", async () => {
    const worker = createMockWorker();
    const request: WorkerRequest = { type: "compile", id: 42, files: {} };

    const promise = workerRpc(worker as any, request);

    worker.emit({ type: "result", id: 42, diagnostics: [] });

    const result = await promise;
    expect(result).toEqual({ type: "result", id: 42, diagnostics: [] });
    expect(worker.postMessage).toHaveBeenCalledWith(request);
  });

  it("ignores messages with wrong id", async () => {
    const worker = createMockWorker();
    const request: WorkerRequest = { type: "compile", id: 1, files: {} };

    const promise = workerRpc(worker as any, request);

    // Wrong id — should not resolve
    worker.emit({ type: "result", id: 999, diagnostics: [] });

    // Listener should still be registered
    expect(worker.listeners).toHaveLength(1);

    // Now send the right id
    worker.emit({ type: "result", id: 1, diagnostics: [] });

    const result = await promise;
    expect(result.id).toBe(1);
  });

  it("rejects on timeout", async () => {
    const worker = createMockWorker();
    const request: WorkerRequest = { type: "compile", id: 5, files: {} };

    const promise = workerRpc(worker as any, request, 1000);

    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow("typst worker timed out after 1000ms");
  });

  it("cleans up listener on resolve", async () => {
    const worker = createMockWorker();
    const request: WorkerRequest = { type: "compile", id: 10, files: {} };

    const promise = workerRpc(worker as any, request);
    worker.emit({ type: "result", id: 10, diagnostics: [] });

    await promise;
    expect(worker.removeEventListener).toHaveBeenCalled();
    expect(worker.listeners).toHaveLength(0);
  });

  it("cleans up listener on timeout", async () => {
    const worker = createMockWorker();
    const request: WorkerRequest = { type: "compile", id: 20, files: {} };

    const promise = workerRpc(worker as any, request, 500);
    vi.advanceTimersByTime(501);

    await expect(promise).rejects.toThrow();
    expect(worker.removeEventListener).toHaveBeenCalled();
    expect(worker.listeners).toHaveLength(0);
  });
});
