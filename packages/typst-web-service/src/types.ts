/** Source range for a diagnostic. All values are 0-indexed. */
export interface DiagnosticRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface DiagnosticMessage {
  package: string;
  path: string;
  severity: "Error" | "Warning" | "Info";
  range: DiagnosticRange;
  message: string;
}

export type WorkerRequest =
  | {
      type: "init";
      id: number;
      wasmUrl: string;
      fonts: string[];
      packages: boolean;
    }
  | { type: "compile"; id: number; files: Record<string, string> }
  | { type: "render"; id: number; files: Record<string, string> }
  | { type: "destroy"; id: number };

export type WorkerResponse =
  | { type: "ready"; id: number }
  | {
      type: "result";
      id: number;
      diagnostics: DiagnosticMessage[];
      vector?: ArrayBuffer;
    }
  | { type: "pdf"; id: number; data: ArrayBuffer }
  | { type: "cancelled"; id: number }
  | { type: "destroyed"; id: number }
  | { type: "error"; id: number; message: string };
