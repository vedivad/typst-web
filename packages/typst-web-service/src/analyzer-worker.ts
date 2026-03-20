import init, { TinymistLanguageServer } from "tinymist-web";
import type { AnalyzerRequest, AnalyzerResponse, LspDiagnostic } from "./analyzer-types.js";
import { postError } from "./worker-utils.js";

let server: TinymistLanguageServer | null = null;

/** Pending diagnostic results keyed by normalized URI. */
const pendingDiagnostics = new Map<string, LspDiagnostic[]>();
/** Callbacks waiting for diagnostics keyed by normalized URI. */
const diagnosticWaiters = new Map<string, (diags: LspDiagnostic[]) => void>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are opaque values from WASM
const events: any[] = [];

function normalizeUri(uri: string): string {
  return uri.startsWith("untitled:/") ? `untitled:${uri.slice("untitled:/".length)}` : uri;
}

function flushEvents(): void {
  if (!server) return;
  while (events.length > 0) {
    for (const event of events.splice(0)) {
      server.on_event(event);
    }
  }
}

/** Wait for diagnostics for a URI, resolving immediately if already available,
 *  or via a callback when publishDiagnostics fires. Falls back after a timeout. */
function awaitDiagnostics(uri: string, timeoutMs = 500): Promise<LspDiagnostic[]> {
  const key = normalizeUri(uri);
  flushEvents();
  if (pendingDiagnostics.has(key)) {
    return Promise.resolve(pendingDiagnostics.get(key)!);
  }
  return new Promise<LspDiagnostic[]>((resolve) => {
    const timer = setTimeout(() => {
      diagnosticWaiters.delete(key);
      resolve(pendingDiagnostics.get(key) ?? []);
    }, timeoutMs);
    diagnosticWaiters.set(key, (diags) => {
      clearTimeout(timer);
      diagnosticWaiters.delete(key);
      resolve(diags);
    });
  });
}

async function initServer(wasmUrl: string): Promise<void> {
  await init(wasmUrl);

  server = new TinymistLanguageServer({
    sendEvent: (event: any): void => void events.push(event),
    sendRequest({ id }: { id: number; method: string; params: unknown }): void {
      // Server-initiated requests (e.g. workspace/configuration).
      // Respond with null to unhandled requests.
      server!.on_response({ id, result: null });
    },
    sendNotification: ({ method, params }: { method: string; params: unknown }): void => {
      if (method === "textDocument/publishDiagnostics") {
        const { uri, diagnostics } = params as { uri: string; diagnostics: LspDiagnostic[] };
        const key = normalizeUri(uri);
        pendingDiagnostics.set(key, diagnostics);
        diagnosticWaiters.get(key)?.(diagnostics);
      }
    },
    resolveFn: () => undefined,
  });

  const initResult = server.on_request("initialize", {
    capabilities: {
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ["markdown", "plaintext"] },
      },
    },
    rootUri: "file:///",
  });

  if (initResult && typeof initResult === "object" && "then" in initResult) {
    await initResult;
  }

  flushEvents();
  server.on_notification("initialized", {});
  flushEvents();
}

self.onmessage = async (e: MessageEvent<AnalyzerRequest>) => {
  const req = e.data;

  if (req.type === "init") {
    try {
      await initServer(req.wasmUrl);
      self.postMessage({ type: "ready", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (!server) {
    postError(req.id, new Error("Analyzer not initialized"));
    return;
  }

  if (req.type === "didOpen") {
    try {
      server.on_notification("textDocument/didOpen", {
        textDocument: {
          uri: req.uri,
          languageId: "typst",
          version: 1,
          text: req.content,
        },
      });
      flushEvents();
      self.postMessage({ type: "ack", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "didChange") {
    try {
      pendingDiagnostics.delete(normalizeUri(req.uri));

      server.on_notification("textDocument/didChange", {
        textDocument: { uri: req.uri, version: req.version },
        contentChanges: [{ text: req.content }],
      });

      const diagnostics = await awaitDiagnostics(req.uri);
      self.postMessage({
        type: "diagnostics",
        id: req.id,
        uri: req.uri,
        diagnostics,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "didChangeFast") {
    try {
      server.on_notification("textDocument/didChange", {
        textDocument: { uri: req.uri, version: req.version },
        contentChanges: [{ text: req.content }],
      });
      flushEvents();
      self.postMessage({ type: "ack", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "completion") {
    try {
      const result = server.on_request("textDocument/completion", {
        textDocument: { uri: req.uri },
        position: { line: req.line, character: req.character },
      });
      const resolved = result && typeof result === "object" && "then" in result
        ? await result
        : result;
      flushEvents();
      self.postMessage({
        type: "completionResult",
        id: req.id,
        result: resolved ?? null,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "hover") {
    try {
      const result = server.on_request("textDocument/hover", {
        textDocument: { uri: req.uri },
        position: { line: req.line, character: req.character },
      });
      const resolved = result && typeof result === "object" && "then" in result
        ? await result
        : result;
      flushEvents();
      self.postMessage({
        type: "hoverResult",
        id: req.id,
        result: resolved ?? null,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "destroy") {
    server.free();
    server = null;
    self.postMessage({ type: "destroyed", id: req.id } satisfies AnalyzerResponse);
  }
};
