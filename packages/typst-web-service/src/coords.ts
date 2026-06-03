// typsten speaks UTF-8 byte offsets; CodeMirror/JS strings speak UTF-16 code
// units. These convert between the two at code-point boundaries (where all
// engine offsets land).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-16 string offset (CodeMirror position) -> UTF-8 byte offset (typsten). */
export function cmOffsetToByte(text: string, offset: number): number {
  return encoder.encode(text.slice(0, offset)).length;
}

/** UTF-8 byte offset (typsten) -> UTF-16 string offset (CodeMirror position). */
export function byteToCmOffset(text: string, byte: number): number {
  if (byte <= 0) return 0;
  const bytes = encoder.encode(text);
  if (byte >= bytes.length) return text.length;
  return decoder.decode(bytes.subarray(0, byte)).length;
}
