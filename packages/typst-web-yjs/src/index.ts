import type { Path, TypstProject } from "@vedivad/typst-web-service";
import * as Y from "yjs";

export interface TypstYjsSync {
  readonly ready: Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
}

export interface TypstYjsSyncError {
  error: unknown;
  operation: "setText" | "setBinary" | "setMany" | "remove";
  path?: string;
}

export interface SyncYTextToTypstProjectOptions {
  project: TypstProject;
  ytext: Y.Text;
  path: Path;
  onError?: (event: TypstYjsSyncError) => void;
}

export interface SyncYMapToTypstProjectOptions<
  V extends Y.Text | Uint8Array = Y.Text | Uint8Array,
> {
  project: TypstProject;
  files: Y.Map<V>;
  onError?: (event: TypstYjsSyncError) => void;
}

type WriteLatest = () => Promise<void>;

class SerializedSync implements TypstYjsSync {
  private dirty = false;
  private disposed = false;
  private running: Promise<void> | undefined;
  readonly ready: Promise<void>;

  constructor(private readonly writeLatest: WriteLatest) {
    this.ready = this.requestSync();
  }

  flush(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
  }

  requestSync(): Promise<void> {
    if (this.disposed) return this.running ?? Promise.resolve();
    this.dirty = true;
    if (!this.running) {
      this.running = this.drain();
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false;
        await this.writeLatest();
      }
    } finally {
      this.running = undefined;
      if (this.dirty && !this.disposed) {
        this.running = this.drain();
      }
    }
  }
}

export function syncYTextToTypstProject(
  options: SyncYTextToTypstProjectOptions,
): TypstYjsSync {
  const { project, ytext, path, onError } = options;

  const sync = new SerializedSync(async () => {
    try {
      await project.setText(path, ytext.toJSON());
    } catch (error) {
      onError?.({ error, operation: "setText", path });
    }
  });

  const observer = () => {
    void sync.requestSync();
  };

  ytext.observe(observer);

  return {
    ready: sync.ready,
    flush: () => sync.flush(),
    dispose: () => {
      ytext.unobserve(observer);
      sync.dispose();
    },
  };
}

export function syncYMapToTypstProject<V extends Y.Text | Uint8Array>(
  options: SyncYMapToTypstProjectOptions<V>,
): TypstYjsSync {
  const { project, files, onError } = options;
  const dirtyPaths = new Set<string>();
  // Binary values never mutate in place, they're replaced via Y.Map.set.
  const textObservers = new Map<
    string,
    {
      text: Y.Text;
      observer: () => void;
    }
  >();
  let dirtyAll = true;

  const markDirty = (path: string) => {
    dirtyPaths.add(path);
    void sync.requestSync();
  };

  const observeText = (path: string, text: Y.Text) => {
    const existing = textObservers.get(path);
    if (existing?.text === text) return;
    if (existing) {
      existing.text.unobserve(existing.observer);
    }
    const observer = () => markDirty(path);
    text.observe(observer);
    textObservers.set(path, { text, observer });
  };

  const unobserveText = (path: string) => {
    const existing = textObservers.get(path);
    if (!existing) return;
    existing.text.unobserve(existing.observer);
    textObservers.delete(path);
  };

  const observeCurrentTexts = () => {
    for (const [path, value] of files.entries()) {
      if (value instanceof Y.Text) {
        observeText(path, value);
      }
    }
  };

  const snapshotValue = (value: Y.Text | Uint8Array): string | Uint8Array =>
    value instanceof Y.Text ? value.toJSON() : value;

  const sync = new SerializedSync(async () => {
    if (dirtyAll) {
      dirtyAll = false;
      dirtyPaths.clear();
      observeCurrentTexts();
      const snapshot: Record<string, string | Uint8Array> = {};
      for (const [path, value] of files.entries()) {
        snapshot[path] = snapshotValue(value);
      }
      if (Object.keys(snapshot).length === 0) return;
      try {
        await project.setMany(snapshot);
      } catch (error) {
        onError?.({ error, operation: "setMany" });
      }
      return;
    }

    const paths = [...dirtyPaths];
    dirtyPaths.clear();

    const textChanges: Record<string, string> = {};
    const binaryChanges: Record<string, Uint8Array> = {};
    const removed: string[] = [];

    for (const path of paths) {
      const value = files.get(path);
      if (value === undefined) {
        removed.push(path);
      } else if (value instanceof Y.Text) {
        observeText(path, value);
        textChanges[path] = value.toJSON();
      } else {
        binaryChanges[path] = value;
      }
    }

    const textEntries = Object.entries(textChanges);
    const binaryEntries = Object.entries(binaryChanges);
    const totalChanges = textEntries.length + binaryEntries.length;

    if (totalChanges === 1) {
      if (textEntries.length === 1) {
        const [path, content] = textEntries[0];
        try {
          await project.setText(path, content);
        } catch (error) {
          onError?.({ error, operation: "setText", path });
        }
      } else {
        const [path, content] = binaryEntries[0];
        try {
          await project.setBinary(path, content);
        } catch (error) {
          onError?.({ error, operation: "setBinary", path });
        }
      }
    } else if (totalChanges > 1) {
      try {
        await project.setMany({ ...textChanges, ...binaryChanges });
      } catch (error) {
        onError?.({ error, operation: "setMany" });
      }
    }

    for (const path of removed) {
      try {
        await project.remove(path);
      } catch (error) {
        onError?.({ error, operation: "remove", path });
      }
    }
  });

  observeCurrentTexts();

  const mapObserver = (event: Y.YMapEvent<V>) => {
    for (const [path, change] of event.changes.keys) {
      if (change.action === "delete" || change.action === "update") {
        unobserveText(path);
      }

      const value = files.get(path);
      if (value instanceof Y.Text) {
        observeText(path, value);
      }

      dirtyPaths.add(path);
    }
    void sync.requestSync();
  };

  files.observe(mapObserver);

  return {
    ready: sync.ready,
    flush: () => sync.flush(),
    dispose: () => {
      files.unobserve(mapObserver);
      for (const path of [...textObservers.keys()]) {
        unobserveText(path);
      }
      sync.dispose();
    },
  };
}
