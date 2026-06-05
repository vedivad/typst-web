// The engine speaks typsten's typed DTOs directly (one wasm, one set of types).
// Re-export them as the package's public shapes.
export type {
  ClickJump,
  CompileResult,
  Completion,
  CompletionKind,
  CompletionResponse,
  Diagnostic,
  HlSpan,
  Hover,
  HoverKind,
  Location,
  PageInfo,
  Severity,
} from "typsten";

/** A rendered page: its index, dimensions (in points), and standalone SVG. */
export interface RenderedSvgPage {
  index: number;
  width: number;
  height: number;
  svg: string;
}
