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

/** Whether `text` has any non-ASCII code unit (byte offset != UTF-16 offset). */
function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

/** UTF-8 length in bytes of a Unicode code point. */
function utf8Len(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Map a batch of offsets from one coordinate space to the other in a single pass
 * over `text`, walking both running positions (`key` = input space, `val` =
 * output space) one code point at a time. `keyStep`/`valStep` give each space's
 * advance per code point. Input may be in any order (nested highlight spans
 * produce non-monotonic boundaries); the result is aligned with the input, and
 * offsets past the end clamp to the output length. Pure-ASCII text (where the
 * two spaces coincide) short-circuits to identity.
 */
function mapOffsets(
  text: string,
  offsets: number[],
  keyStep: (codePoint: number, ch: string) => number,
  valStep: (codePoint: number, ch: string) => number,
): number[] {
  if (offsets.length === 0 || !hasNonAscii(text)) return offsets;

  // Walk in ascending input order, but remember each offset's original slot.
  const order = offsets.map((offset, i) => [offset, i] as const);
  order.sort((a, b) => a[0] - b[0]);

  const out = new Array<number>(offsets.length);
  let key = 0;
  let val = 0;
  let next = 0;
  const flush = () => {
    while (next < order.length && order[next][0] <= key)
      out[order[next++][1]] = val;
  };
  flush(); // offsets at position 0
  for (const ch of text) {
    if (next >= order.length) break;
    const cp = ch.codePointAt(0)!;
    key += keyStep(cp, ch);
    val += valStep(cp, ch);
    flush();
  }
  // Past the end: the loop ran to completion, so `val` is the full output length.
  while (next < order.length) out[order[next++][1]] = val;
  return out;
}

/**
 * Convert a batch of UTF-8 byte offsets to UTF-16 (CodeMirror) offsets in one
 * pass. Unlike `byteToCmOffset` (which re-encodes a prefix per call, so N
 * offsets cost O(N * len)), this is O(len + N log N). Used to map highlight span
 * boundaries back to editor coordinates.
 */
export function byteOffsetsToCm(text: string, offsets: number[]): number[] {
  return mapOffsets(
    text,
    offsets,
    (cp) => utf8Len(cp),
    (_cp, ch) => ch.length,
  );
}

/**
 * Convert a batch of UTF-16 (CodeMirror) offsets to UTF-8 byte offsets in one
 * pass. The batched, ASCII-fast-path counterpart to `cmOffsetToByte` (which
 * re-encodes a prefix per call). Used for the highlight viewport bounds.
 */
export function cmOffsetsToByte(text: string, offsets: number[]): number[] {
  return mapOffsets(
    text,
    offsets,
    (_cp, ch) => ch.length,
    (cp) => utf8Len(cp),
  );
}
