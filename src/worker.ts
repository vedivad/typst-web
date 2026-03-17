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

import type { WorkerRequest, WorkerResponse, DiagnosticMessage } from "./types.js";

// typst-ts-web-compiler format enum: 1 = PDF
const PDF_FORMAT = 1;

const accessModel = new MemoryAccessModel();
const packageRegistry = new FetchPackageRegistry(accessModel);

let compiler: TypstCompiler | null = null;

async function initCompiler(wasmUrl: string, fontUrls: string[], packages: boolean): Promise<void> {
  // createTypstCompiler() returns a looser type; cast to the full interface
  compiler = createTypstCompiler() as unknown as TypstCompiler;
  await compiler.init({
    getModule: () => wasmUrl,
    beforeBuild: [
      loadFonts(fontUrls),
      ...(packages ? [withAccessModel(accessModel), withPackageRegistry(packageRegistry)] : []),
    ],
  });
}

async function compile(source: string): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }> {
  if (!compiler) throw new Error("Compiler not initialized");
  compiler.addSource("/main.typ", source);
  const result = await compiler.compile({ mainFilePath: "/main.typ", diagnostics: "full" });
  // The compiler types severity as string; cast to our narrower union
  return { diagnostics: (result.diagnostics ?? []) as DiagnosticMessage[], vector: result.result ?? undefined };
}

function postError(id: number, err: unknown): void {
  self.postMessage({
    type: "error",
    id,
    message: err instanceof Error ? err.message : String(err),
  } satisfies WorkerResponse);
}

function transferBuffer(data: Uint8Array): ArrayBuffer {
  // data.buffer is ArrayBuffer in a Worker context (not SharedArrayBuffer)
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === "init") {
    try {
      await initCompiler(req.wasmUrl, req.fonts, req.packages);
      self.postMessage({ type: "ready", id: req.id } satisfies WorkerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "compile") {
    try {
      const { diagnostics, vector: vectorData } = await compile(req.source);
      const vector = vectorData ? transferBuffer(vectorData) : undefined;
      const msg: WorkerResponse = { type: "result", id: req.id, diagnostics, vector };
      self.postMessage(msg, vector ? [vector] : []);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "render") {
    try {
      if (!compiler) throw new Error("Compiler not initialized");
      compiler.addSource("/main.typ", req.source);
      const result = await compiler.compile({
        mainFilePath: "/main.typ",
        format: PDF_FORMAT,
        diagnostics: "none",
      } as Parameters<typeof compiler.compile>[0]);
      if (!result.result) throw new Error("Compilation produced no output");
      const data = transferBuffer(result.result);
      self.postMessage({ type: "pdf", id: req.id, data } satisfies WorkerResponse, [data]);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "destroy") {
    self.postMessage({ type: "destroyed", id: req.id } satisfies WorkerResponse);
  }
};
