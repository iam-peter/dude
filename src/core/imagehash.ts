// Perceptual difference hash (dHash) for screenshot dedupe (D5): 9×8 grayscale, one bit
// per horizontal neighbour comparison, 64 bits as 16 hex digits.

/** `gray` is 9×8 = 72 luminance values, row by row. */
export function dHashFromGray(gray: ArrayLike<number>): string {
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let bits = 0;
    for (let col = 0; col < 8; col++) {
      if (gray[row * 9 + col] > gray[row * 9 + col + 1]) bits |= 1 << (7 - col);
    }
    hex += bits.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Captures closer than this are "the same picture" and not stored again. */
export const SAME_PICTURE = 5;

/** FNV-1a, for "same text as last time". */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}
