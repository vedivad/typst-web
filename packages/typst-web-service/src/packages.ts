// typsten resolves `@preview` packages from its in-memory VFS but does no I/O.
// This is the JS side: scan sources for `@preview` imports, fetch the tarball
// from the registry, unpack it, and push every member into the VFS. (The eager
// import-scanner approach; a lazy JSPI fetch is a future typsten milestone.)
import { gunzipSync } from "fflate";
import { parseTar } from "nanotar";

const REGISTRY = "https://packages.typst.org/preview";
const PREVIEW_IMPORT = /@preview\/([a-zA-Z0-9_-]+):(\d+\.\d+\.\d+)/g;

export type SetFile = (path: string, bytes: Uint8Array) => Promise<void> | void;

export interface PackageLoader {
  /**
   * Ensure every `@preview` package referenced in `sources` is present in the
   * VFS. Returns `true` if anything new was fetched (so the caller can recompile).
   */
  ensure(sources: Iterable<string>): Promise<boolean>;
}

export function createPackageLoader(setFile: SetFile): PackageLoader {
  const loaded = new Set<string>();
  const inflight = new Map<string, Promise<void>>();

  async function fetchPackage(name: string, version: string): Promise<void> {
    const spec = `@preview/${name}:${version}`;
    const res = await fetch(`${REGISTRY}/${name}-${version}.tar.gz`);
    if (!res.ok) {
      throw new Error(
        `failed to fetch ${spec}: ${res.status} ${res.statusText}`,
      );
    }
    const tar = gunzipSync(new Uint8Array(await res.arrayBuffer()));
    for (const entry of parseTar(tar)) {
      // Skip directories and anything without bytes.
      if (!entry.data || entry.name.endsWith("/")) continue;
      await setFile(`${spec}/${entry.name}`, entry.data);
    }
  }

  return {
    async ensure(sources) {
      const specs = new Set<string>();
      for (const text of sources) {
        for (const m of text.matchAll(PREVIEW_IMPORT)) {
          specs.add(`${m[1]}:${m[2]}`);
        }
      }

      let fetched = false;
      const tasks: Promise<void>[] = [];
      for (const spec of specs) {
        if (loaded.has(spec)) continue;
        fetched = true;
        let task = inflight.get(spec);
        if (!task) {
          const [name, version] = spec.split(":");
          task = fetchPackage(name, version)
            .then(() => {
              loaded.add(spec);
            })
            .finally(() => {
              inflight.delete(spec);
            });
          inflight.set(spec, task);
        }
        tasks.push(task);
      }
      await Promise.all(tasks);
      return fetched;
    },
  };
}
