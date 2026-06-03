import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  syncYMapToTypstProject,
  syncYTextToTypstProject,
  type TypstYjsSyncError,
} from "../index.js";

function mockProject() {
  return {
    setText: vi.fn().mockResolvedValue(undefined),
    setBinary: vi.fn().mockResolvedValue(undefined),
    setMany: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function ytext(content = "", name = "text"): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText(name);
  if (content) text.insert(0, content);
  return text;
}

function yfiles(): Y.Map<Y.Text | Uint8Array> {
  const doc = new Y.Doc();
  return doc.getMap("files");
}

function addFile(
  files: Y.Map<Y.Text | Uint8Array>,
  path: string,
  content = "",
): Y.Text {
  const text = new Y.Text();
  files.set(path, text);
  if (content) text.insert(0, content);
  return text;
}

function addBinary(
  files: Y.Map<Y.Text | Uint8Array>,
  path: string,
  bytes: ArrayLike<number>,
): Uint8Array {
  const value = new Uint8Array(bytes);
  files.set(path, value);
  return value;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("syncYTextToTypstProject", () => {
  it("seeds the project with the initial Y.Text content", async () => {
    const project = mockProject();
    const text = ytext("hello");
    const sync = syncYTextToTypstProject({
      project: project as any,
      ytext: text,
      path: "/main.typ",
    });

    await sync.ready;
    expect(project.setText).toHaveBeenCalledWith("/main.typ", "hello");
  });

  it("syncs Y.Text edits to the project", async () => {
    const project = mockProject();
    const text = ytext("hello");
    const sync = syncYTextToTypstProject({
      project: project as any,
      ytext: text,
      path: "/main.typ",
    });
    await sync.ready;
    project.setText.mockClear();

    text.insert(5, "!");
    await sync.flush();

    expect(project.setText).toHaveBeenCalledWith("/main.typ", "hello!");
  });

  it("serializes overlapping writes and finishes with the latest state", async () => {
    const first = deferred();
    const project = mockProject();
    project.setText
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const text = ytext("one");
    const sync = syncYTextToTypstProject({
      project: project as any,
      ytext: text,
      path: "/main.typ",
    });

    text.delete(0, 3);
    text.insert(0, "two");
    expect(project.setText).toHaveBeenCalledTimes(1);
    first.resolve();
    await sync.ready;
    await sync.flush();

    expect(project.setText).toHaveBeenNthCalledWith(1, "/main.typ", "one");
    expect(project.setText).toHaveBeenNthCalledWith(2, "/main.typ", "two");
  });

  it("stops observing after dispose", async () => {
    const project = mockProject();
    const text = ytext("hello");
    const sync = syncYTextToTypstProject({
      project: project as any,
      ytext: text,
      path: "/main.typ",
    });
    await sync.ready;
    project.setText.mockClear();

    sync.dispose();
    text.insert(5, "!");
    await sync.flush();

    expect(project.setText).not.toHaveBeenCalled();
  });

  it("reports setText errors and continues syncing later edits", async () => {
    const project = mockProject();
    const errors: TypstYjsSyncError[] = [];
    project.setText
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const text = ytext("hello");
    const sync = syncYTextToTypstProject({
      project: project as any,
      ytext: text,
      path: "/main.typ",
      onError: (event) => errors.push(event),
    });

    await sync.ready;
    text.insert(5, "!");
    await sync.flush();

    expect(errors).toHaveLength(1);
    expect(errors[0].operation).toBe("setText");
    expect(errors[0].path).toBe("/main.typ");
    expect(project.setText).toHaveBeenLastCalledWith("/main.typ", "hello!");
  });
});

describe("syncYMapToTypstProject", () => {
  it("seeds the project with the initial Y.Map files", async () => {
    const project = mockProject();
    const files = yfiles();
    addFile(files, "/main.typ", "main");
    addFile(files, "/util.typ", "util");

    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });

    await sync.ready;
    expect(project.setMany).toHaveBeenCalledWith({
      "/main.typ": "main",
      "/util.typ": "util",
    });
  });

  it("syncs nested Y.Text edits for the changed file", async () => {
    const project = mockProject();
    const files = yfiles();
    const main = addFile(files, "/main.typ", "main");
    addFile(files, "/util.typ", "util");
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;
    project.setText.mockClear();
    project.setMany.mockClear();

    main.insert(4, "!");
    await sync.flush();

    expect(project.setText).toHaveBeenCalledWith("/main.typ", "main!");
    expect(project.setMany).not.toHaveBeenCalled();
  });

  it("observes files added after startup", async () => {
    const project = mockProject();
    const files = yfiles();
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;

    const added = addFile(files, "/added.typ", "added");
    await sync.flush();
    project.setText.mockClear();

    added.insert(5, "!");
    await sync.flush();

    expect(project.setText).toHaveBeenCalledWith("/added.typ", "added!");
  });

  it("removes files deleted from the map", async () => {
    const project = mockProject();
    const files = yfiles();
    addFile(files, "/main.typ", "main");
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;

    files.delete("/main.typ");
    await sync.flush();

    expect(project.remove).toHaveBeenCalledWith("/main.typ");
  });

  it("unobserves replaced text values", async () => {
    const project = mockProject();
    const files = yfiles();
    const oldText = addFile(files, "/main.typ", "old");
    const newText = new Y.Text();
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;

    files.set("/main.typ", newText);
    newText.insert(0, "new");
    await sync.flush();
    project.setText.mockClear();

    oldText.insert(3, "!");
    newText.insert(3, "!");
    await sync.flush();

    expect(project.setText).toHaveBeenCalledTimes(1);
    expect(project.setText).toHaveBeenCalledWith("/main.typ", "new!");
  });

  it("flushes changes that arrive during an in-flight write", async () => {
    const first = deferred();
    const project = mockProject();
    project.setMany
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const files = yfiles();
    const main = addFile(files, "/main.typ", "one");
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });

    main.delete(0, 3);
    main.insert(0, "two");
    expect(project.setMany).toHaveBeenCalledTimes(1);
    first.resolve();
    await sync.ready;
    await sync.flush();

    expect(project.setMany).toHaveBeenNthCalledWith(1, {
      "/main.typ": "one",
    });
    expect(project.setText).toHaveBeenCalledWith("/main.typ", "two");
  });

  it("seeds binary entries through the initial setMany", async () => {
    const project = mockProject();
    const files = yfiles();
    addFile(files, "/main.typ", "main");
    const bytes = addBinary(files, "/logo.png", [137, 80, 78, 71]);

    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });

    await sync.ready;
    expect(project.setMany).toHaveBeenCalledWith({
      "/main.typ": "main",
      "/logo.png": bytes,
    });
  });

  it("uses setBinary when a single binary file is added after startup", async () => {
    const project = mockProject();
    const files = yfiles();
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;
    project.setMany.mockClear();

    const bytes = addBinary(files, "/logo.png", [137, 80, 78, 71]);
    await sync.flush();

    expect(project.setBinary).toHaveBeenCalledWith("/logo.png", bytes);
    expect(project.setMany).not.toHaveBeenCalled();
  });

  it("uses setMany for mixed text + binary changes", async () => {
    const project = mockProject();
    const files = yfiles();
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;
    project.setMany.mockClear();

    const doc = files.doc!;
    doc.transact(() => {
      addFile(files, "/main.typ", "main");
      addBinary(files, "/logo.png", [1, 2, 3]);
    });
    await sync.flush();

    expect(project.setMany).toHaveBeenCalledTimes(1);
    const call = project.setMany.mock.calls[0][0];
    expect(call["/main.typ"]).toBe("main");
    expect(call["/logo.png"]).toBeInstanceOf(Uint8Array);
  });

  it("removes binary files deleted from the map", async () => {
    const project = mockProject();
    const files = yfiles();
    addBinary(files, "/logo.png", [1, 2, 3]);
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;

    files.delete("/logo.png");
    await sync.flush();

    expect(project.remove).toHaveBeenCalledWith("/logo.png");
  });

  it("handles a key changing type from Y.Text to Uint8Array", async () => {
    const project = mockProject();
    const files = yfiles();
    const oldText = addFile(files, "/asset", "text content");
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
    });
    await sync.ready;
    project.setText.mockClear();
    project.setBinary.mockClear();

    const bytes = addBinary(files, "/asset", [9, 9, 9]);
    await sync.flush();
    expect(project.setBinary).toHaveBeenCalledWith("/asset", bytes);

    // The old Y.Text should no longer be observed - edits to it must not
    // produce setText calls.
    project.setText.mockClear();
    oldText.insert(0, "edit");
    await sync.flush();
    expect(project.setText).not.toHaveBeenCalled();
  });

  it("reports setBinary errors and continues", async () => {
    const project = mockProject();
    const errors: TypstYjsSyncError[] = [];
    project.setBinary
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const files = yfiles();
    const sync = syncYMapToTypstProject({
      project: project as any,
      files,
      onError: (event) => errors.push(event),
    });
    await sync.ready;

    addBinary(files, "/logo.png", [1, 2, 3]);
    await sync.flush();

    expect(errors).toHaveLength(1);
    expect(errors[0].operation).toBe("setBinary");
    expect(errors[0].path).toBe("/logo.png");
  });

  it("accepts a narrower Y.Map<Y.Text> without a cast", async () => {
    const project = mockProject();
    const doc = new Y.Doc();
    const files: Y.Map<Y.Text> = doc.getMap("files");
    files.set("/main.typ", new Y.Text("hello"));

    const sync = syncYMapToTypstProject({ project: project as any, files });
    await sync.ready;

    expect(project.setMany).toHaveBeenCalledWith({ "/main.typ": "hello" });
    sync.dispose();
  });
});
