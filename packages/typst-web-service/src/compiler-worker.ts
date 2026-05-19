import * as Comlink from "comlink";
import {
  CompileFormatEnum,
  createTypstCompiler,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts/compiler";
import { MemoryAccessModel } from "@myriaddreamin/typst.ts/fs/memory";
import { FetchPackageRegistry } from "@myriaddreamin/typst.ts/fs/package";
import {
  loadFonts,
  withAccessModel,
  withPackageRegistry,
} from "@myriaddreamin/typst.ts/options.init";
import { sortDiagnosticsByFileAndRange } from "./diagnostics-sort.js";
import type { DiagnosticMessage } from "./types.js";

const MAIN_FILE = "/main.typ";

export class CompilerWorker {
  #compiler: TypstCompiler | null = null;
  readonly #accessModel = new MemoryAccessModel();
  readonly #packageRegistry: FetchPackageRegistry;

  constructor() {
    this.#packageRegistry = new FetchPackageRegistry(this.#accessModel);
  }

  #ensureCompiler(): TypstCompiler {
    if (!this.#compiler) throw new Error("Compiler not initialized");
    return this.#compiler;
  }

  async init(
    wasmUrl: string,
    fontUrls: string[],
    packages: boolean,
  ): Promise<void> {
    this.#compiler = createTypstCompiler();
    await this.#compiler.init({
      getModule: () => wasmUrl,
      beforeBuild: [
        loadFonts(fontUrls),
        ...(packages
          ? [
              withAccessModel(this.#accessModel),
              withPackageRegistry(this.#packageRegistry),
            ]
          : []),
      ],
    });
  }

  async compile(
    entry?: string,
  ): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }> {
    // typst.ts's `get_artifact` returns diagnostics only on a *failed* compile;
    // on success it returns `{ result }` with no `diagnostics` field, dropping
    // any warnings. Run `vector()` then `compile()` on the same world: the
    // first call primes `shared_compile`, the second is a cache hit just to
    // collect diagnostics.
    //
    // Order matters, `compile()` first runs `get_diag -> TDiagnosticsTask`,
    // which invalidates the cached paged doc, so `vector()` would then return
    // `None` (SDK falls back to `{}`).
    type RawDiag = {
      package: string;
      path: string;
      severity: string;
      range: string;
      message: string;
    };
    // typst.ts's `TypstWorld` typings widen everything to `unknown`; declare
    // the actual wasm response shapes once here.
    type VectorResponse =
      | { result: Uint8Array }
      | { hasError: boolean; diagnostics: RawDiag[] };
    type CompileResponse = { hasError: boolean; diagnostics: RawDiag[] };

    const { rawDiagnostics, vector } = await this.#ensureCompiler().runWithWorld(
      { mainFilePath: entry ?? MAIN_FILE },
      async (world) => {
        // `diagnostics: "full"` keeps failures on the resolved path,
        // `{ hasError, diagnostics }`, instead of rejecting. A reject here
        // would be a hard internal error; propagating is the right call so
        // `errorAsCompileResult` upstream surfaces it.
        const v = (await world.vector({ diagnostics: "full" })) as VectorResponse;

        if (!("result" in v)) {
          // Failure path — diagnostics are inline.
          return { rawDiagnostics: v.diagnostics, vector: undefined };
        }
        // Success path, vector() omits diagnostics. Fetch them now that the
        // cache is primed. Guarded so a flaky diagnostic fetch can never
        // shadow the artifact we already have in hand.
        let rawDiagnostics: RawDiag[] = [];
        try {
          const c = (await world.compile({ diagnostics: "full" })) as CompileResponse;
          rawDiagnostics = c.diagnostics;
        } catch (err) {
          console.error("[typst-web-service] compile() threw after vector():", err);
        }
        return { rawDiagnostics, vector: v.result };
      },
    );
    const diagnostics = sortDiagnosticsByFileAndRange(
      rawDiagnostics.map((d) => {
        const m = d.range.match(/(\d+):(\d+)-(\d+):(\d+)/);
        return {
          ...d,
          severity: d.severity as DiagnosticMessage["severity"],
          range: m
            ? { startLine: +m[1], startCol: +m[2], endLine: +m[3], endCol: +m[4] }
            : { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        };
      }),
    );
    if (vector) {
      return Comlink.transfer({ diagnostics, vector }, [
        vector.buffer as ArrayBuffer,
      ]);
    }
    return { diagnostics };
  }

  async compilePdf(entry?: string): Promise<Uint8Array> {
    const result = await this.#ensureCompiler().compile({
      mainFilePath: entry ?? MAIN_FILE,
      format: CompileFormatEnum.pdf,
      diagnostics: "none",
    });
    if (!result.result) throw new Error("Compilation produced no output");
    return Comlink.transfer(result.result, [
      result.result.buffer as ArrayBuffer,
    ]);
  }

  mapShadow(path: string, content: Uint8Array): void {
    this.#ensureCompiler().mapShadow(path, content);
  }

  mapShadowMany(files: Record<string, Uint8Array>): void {
    const compiler = this.#ensureCompiler();
    for (const [path, content] of Object.entries(files)) {
      compiler.mapShadow(path, content);
    }
  }

  unmapShadow(path: string): void {
    this.#ensureCompiler().unmapShadow(path);
  }

  resetShadow(): void {
    this.#ensureCompiler().resetShadow();
  }

  destroy(): void {
    this.#compiler = null;
  }
}

Comlink.expose(new CompilerWorker());
