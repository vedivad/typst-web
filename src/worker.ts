import {
  createTypstCompiler,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts/compiler";

import {
  loadFonts,
  withPackageRegistry,
  withAccessModel,
} from "@myriaddreamin/typst.ts/options.init";

import { FetchPackageRegistry } from "@myriaddreamin/typst.ts/fs/package";
import { MemoryAccessModel } from "@myriaddreamin/typst.ts/fs/memory";

import type {
  WorkerRequest,
  WorkerResponse,
  DiagnosticMessage,
} from "./types.js";

interface IncrementalServer {
  reset(): void;
  current(): Uint8Array | undefined;
  setAttachDebugInfo(enable: boolean): void;
}

const accessModel = new MemoryAccessModel();
const packageRegistry = new FetchPackageRegistry(accessModel);

let compiler: TypstCompiler | null = null;
let incrServer: IncrementalServer | null = null;
let shutdownResolve: (() => void) | null = null;

async function initCompiler(
  wasmUrl: string,
  fontUrls: string[],
  packages: boolean,
): Promise<void> {
  compiler = createTypstCompiler() as unknown as TypstCompiler;
  await compiler.init({
    getModule: () => wasmUrl,
    beforeBuild: [
      loadFonts(fontUrls),
      ...(packages ? [withAccessModel(accessModel), withPackageRegistry(packageRegistry)] : []),
    ],
  });

  // Keep the IncrementalServer alive for the lifetime of this worker
  const serverReady = new Promise<IncrementalServer>((resolve) => {
    const shutdownSignal = new Promise<void>((r) => {
      shutdownResolve = r;
    });

    compiler!.withIncrementalServer(async (server) => {
      resolve(server);
      await shutdownSignal;
    });
  });

  incrServer = await serverReady;
}

async function compile(source: string): Promise<DiagnosticMessage[]> {
  if (!compiler || !incrServer) throw new Error("Compiler not initialized");

  compiler.addSource("/main.typ", source);

  const result = await compiler.compile({
    mainFilePath: "/main.typ",
    incrementalServer: incrServer,
    diagnostics: "full",
  });

  return result.diagnostics ?? [];
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === "init") {
    try {
      await initCompiler(req.wasmUrl, req.fonts, req.packages);
      self.postMessage({ type: "ready", id: req.id } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: "error",
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (req.type === "compile") {
    try {
      const diagnostics = await compile(req.source);
      self.postMessage({
        type: "result",
        id: req.id,
        diagnostics,
      } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: "error",
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (req.type === "render") {
    try {
      if (!compiler) throw new Error("Compiler not initialized");
      compiler.addSource("/main.typ", req.source);
      const result = await compiler.compile({
        mainFilePath: "/main.typ",
        format: 1, // PDF
        diagnostics: "none",
      } as Parameters<typeof compiler.compile>[0]);
      if (!result.result) throw new Error("Compilation produced no output");
      const data = result.result.buffer;
      self.postMessage({ type: "pdf", id: req.id, data } satisfies WorkerResponse, [data]);
    } catch (err) {
      self.postMessage({
        type: "error",
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (req.type === "destroy") {
    shutdownResolve?.();
    self.postMessage({ type: "ready", id: req.id } satisfies WorkerResponse);
  }
};
