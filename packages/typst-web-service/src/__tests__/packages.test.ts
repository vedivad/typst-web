import { gzipSync } from "fflate";
import { createTar } from "nanotar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPackageLoader } from "../packages.js";

/** Build a gzipped tar for a package from a `{ filename: contents }` map. */
function tarball(files: Record<string, string>): ArrayBuffer {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
  const gz = gzipSync(createTar(entries));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

/**
 * Stub `fetch` with a fake registry (`"name-version"` -> file map). Returns the
 * list of fetched keys so tests can assert what (and how often) was requested.
 */
function mockRegistry(
  packages: Record<string, Record<string, string>>,
): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const key = /\/preview\/(.+)\.tar\.gz$/.exec(url)?.[1] ?? "";
      calls.push(key);
      const files = packages[key];
      if (!files) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(tarball(files)),
      } as unknown as Response);
    }),
  );
  return calls;
}

describe("createPackageLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a package and its transitive @preview deps", async () => {
    mockRegistry({
      "aaa-0.1.0": {
        "typst.toml": '[package]\nentrypoint = "lib.typ"',
        "lib.typ": '#import "@preview/bbb:0.2.0": *',
      },
      "bbb-0.2.0": { "typst.toml": "[package]", "lib.typ": "#let x = 1" },
    });
    const written = new Set<string>();
    const loader = createPackageLoader((path) => {
      written.add(path);
    });

    await loader.ensure(['#import "@preview/aaa:0.1.0": *']);

    expect(written).toContain("@preview/aaa:0.1.0/lib.typ");
    // The transitive dep, discovered inside aaa's own lib.typ, is fetched too.
    expect(written).toContain("@preview/bbb:0.2.0/typst.toml");
    expect(written).toContain("@preview/bbb:0.2.0/lib.typ");
  });

  it("does not deadlock on self or cyclic imports", async () => {
    mockRegistry({
      // aaa imports itself and bbb; bbb imports aaa back (a cycle).
      "aaa-0.1.0": {
        "lib.typ": '#import "@preview/aaa:0.1.0"\n#import "@preview/bbb:0.2.0"',
      },
      "bbb-0.2.0": { "lib.typ": '#import "@preview/aaa:0.1.0"' },
    });
    const written = new Set<string>();
    const loader = createPackageLoader((path) => {
      written.add(path);
    });

    await loader.ensure(['#import "@preview/aaa:0.1.0"']);

    expect(written).toContain("@preview/aaa:0.1.0/lib.typ");
    expect(written).toContain("@preview/bbb:0.2.0/lib.typ");
  });

  it("fetches each package once across repeated ensure calls", async () => {
    const calls = mockRegistry({
      "aaa-0.1.0": { "lib.typ": '#import "@preview/bbb:0.2.0"' },
      "bbb-0.2.0": { "lib.typ": "" },
    });
    const loader = createPackageLoader(() => {});

    await loader.ensure(['#import "@preview/aaa:0.1.0"']);
    await loader.ensure([
      '#import "@preview/aaa:0.1.0"',
      '#import "@preview/bbb:0.2.0"',
    ]);

    expect(calls.filter((c) => c === "aaa-0.1.0")).toHaveLength(1);
    expect(calls.filter((c) => c === "bbb-0.2.0")).toHaveLength(1);
  });

  it("retries a failed fetch on a later call", async () => {
    const calls: string[] = [];
    let available = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const key = /\/preview\/(.+)\.tar\.gz$/.exec(url)?.[1] ?? "";
        calls.push(key);
        if (!available) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(tarball({ "lib.typ": "" })),
        } as unknown as Response);
      }),
    );
    const loader = createPackageLoader(() => {});

    await expect(
      loader.ensure(['#import "@preview/bbb:0.2.0"']),
    ).rejects.toThrow(/failed to fetch/);
    available = true;
    await expect(
      loader.ensure(['#import "@preview/bbb:0.2.0"']),
    ).resolves.toBeUndefined();

    expect(calls.filter((c) => c === "bbb-0.2.0")).toHaveLength(2);
  });
});
