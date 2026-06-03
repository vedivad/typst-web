// typsten resolves `@preview` packages from its in-memory VFS but does no I/O.
// This is the JS side: scan sources for `@preview` imports, fetch the tarball
// from the registry, unpack it, and push every member into the VFS. A package's
// own sources may import further `@preview` packages, so after unpacking we scan
// the fetched `.typ` files and follow those transitive imports to a fixed point.
// (The eager import-scanner approach; a lazy JSPI fetch is a future typsten
// milestone that would let the engine drive resolution instead.)
import { gunzipSync } from "fflate";
import { parseTar } from "nanotar";

const REGISTRY = "https://packages.typst.org/preview";
const PREVIEW_IMPORT = /@preview\/([a-zA-Z0-9_-]+):(\d+\.\d+\.\d+)/g;

export type SetFile = (path: string, bytes: Uint8Array) => Promise<void> | void;

export interface PackageLoader {
  /**
   * Ensure every `@preview` package referenced in `sources`, and transitively
   * by the packages they pull in, is present in the VFS, fetching any missing.
   */
  ensure(sources: Iterable<string>): Promise<void>;
}

/** Collect the `name:version` spec of every `@preview` import in `text`. */
function specsIn(text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(PREVIEW_IMPORT)) specs.push(`${m[1]}:${m[2]}`);
  return specs;
}

export function createPackageLoader(setFile: SetFile): PackageLoader {
  const decoder = new TextDecoder();
  // spec ("name:version") -> the transitive specs found inside that package.
  // Doubles as the fetch cache: a settled entry means the package is resident.
  const fetched = new Map<string, Promise<string[]>>();

  async function fetchPackage(spec: string): Promise<string[]> {
    const [name, version] = spec.split(":");
    const qualified = `@preview/${spec}`;
    const res = await fetch(`${REGISTRY}/${name}-${version}.tar.gz`);
    if (!res.ok) {
      throw new Error(
        `failed to fetch ${qualified}: ${res.status} ${res.statusText}`,
      );
    }
    const tar = gunzipSync(new Uint8Array(await res.arrayBuffer()));
    const nested = new Set<string>();
    for (const entry of parseTar(tar)) {
      // Skip directories and anything without bytes.
      if (!entry.data || entry.name.endsWith("/")) continue;
      await setFile(`${qualified}/${entry.name}`, entry.data);
      // A package's own `.typ` sources may import further `@preview` packages.
      if (entry.name.endsWith(".typ")) {
        for (const s of specsIn(decoder.decode(entry.data))) nested.add(s);
      }
    }
    return [...nested];
  }

  function fetchOnce(spec: string): Promise<string[]> {
    let task = fetched.get(spec);
    if (!task) {
      task = fetchPackage(spec).catch((err: unknown) => {
        // Drop failed fetches so a later compile can retry (transient network).
        fetched.delete(spec);
        throw err;
      });
      fetched.set(spec, task);
    }
    return task;
  }

  return {
    async ensure(sources) {
      const seen = new Set<string>();
      let frontier = new Set<string>();
      for (const text of sources) {
        for (const s of specsIn(text)) frontier.add(s);
      }
      // Breadth-first fetch to a fixed point; each package can reveal more.
      while (frontier.size > 0) {
        const batch = [...frontier].filter((s) => !seen.has(s));
        for (const s of batch) seen.add(s);
        frontier = new Set();
        const nestedLists = await Promise.all(batch.map(fetchOnce));
        for (const list of nestedLists) {
          for (const s of list) if (!seen.has(s)) frontier.add(s);
        }
      }
    },
  };
}
