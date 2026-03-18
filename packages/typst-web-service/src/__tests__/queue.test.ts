import { describe, expect, it, vi } from "vitest";
import { makeQueue } from "../queue.js";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("makeQueue", () => {
  it("processes a single request", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const enqueue = makeQueue(handle);

    enqueue({ id: 1 });
    await flush();

    expect(handle).toHaveBeenCalledWith({ id: 1 });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid requests, only processing the latest", async () => {
    const handled: number[] = [];
    const handle = vi.fn().mockImplementation(async (req: { id: number }) => {
      handled.push(req.id);
    });
    const onCancel = vi.fn();
    const enqueue = makeQueue(handle, onCancel);

    // Fire three requests synchronously — only the last should be handled
    enqueue({ id: 1 });
    enqueue({ id: 2 });
    enqueue({ id: 3 });

    // Let the queue drain fully
    await flush();
    await flush();

    expect(handled).toEqual([3]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith({ id: 1 });
  });

  it("cancels in-flight request when a new one arrives during processing", async () => {
    let resolveFirst: () => void;
    const firstProcessing = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const handled: number[] = [];
    const handle = vi.fn().mockImplementation(async (req: { id: number }) => {
      if (req.id === 1) await firstProcessing;
      handled.push(req.id);
    });
    const onCancel = vi.fn();
    const enqueue = makeQueue(handle, onCancel);

    enqueue({ id: 1 });
    await flush(); // starts processing id:1

    // While id:1 is processing, enqueue id:2
    enqueue({ id: 2 });
    resolveFirst!(); // let id:1 finish

    await flush();
    await flush();

    // Both should be handled (id:1 was already processing, id:2 is next)
    expect(handled).toContain(1);
    expect(handled).toContain(2);
  });

  it("does not call onCancel when there is no callback", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const enqueue = makeQueue(handle);

    // Should not throw even without onCancel
    enqueue({ id: 1 });
    enqueue({ id: 2 });

    await flush();
    await flush();
  });

  it("processes sequential requests when each completes before the next", async () => {
    const handled: number[] = [];
    const handle = vi.fn().mockImplementation(async (req: { id: number }) => {
      handled.push(req.id);
    });
    const enqueue = makeQueue(handle);

    enqueue({ id: 1 });
    await flush();
    await flush();

    enqueue({ id: 2 });
    await flush();
    await flush();

    expect(handled).toEqual([1, 2]);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("handles errors in the handler without breaking the queue", async () => {
    let callCount = 0;
    const handle = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("handler error");
    });
    const enqueue = makeQueue(handle);

    enqueue({ id: 1 });
    await flush();
    // Error is thrown but queue should still work
    await flush();

    enqueue({ id: 2 });
    await flush();
    await flush();

    expect(handle).toHaveBeenCalledTimes(2);
  });
});
