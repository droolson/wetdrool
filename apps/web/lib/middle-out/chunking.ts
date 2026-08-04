/**
 * Content-defined chunking (FastCDC-style Gear hash) — WokeNet middle-out Layer 1.
 * Adapted for chat/media envelopes with smaller default chunk sizes.
 * Source inspiration: wokenet/packages/middle-out (not a full vendor).
 */

export interface Chunk {
  readonly offset: number;
  readonly length: number;
}

export interface ChunkingOptions {
  readonly minSize?: number;
  readonly avgSize?: number;
  readonly maxSize?: number;
}

/** Chat-scale defaults (bytes). Media segments should use larger sizes. */
export const CHAT_CHUNKING: Required<ChunkingOptions> = Object.freeze({
  minSize: 256,
  avgSize: 1024,
  maxSize: 4096,
});

export const MEDIA_CHUNKING: Required<ChunkingOptions> = Object.freeze({
  minSize: 8 * 1024,
  avgSize: 32 * 1024,
  maxSize: 128 * 1024,
});

function maskForAvg(avgSize: number, strict: boolean): number {
  // log2(avg) bits set — fewer bits ⇒ more boundaries
  const bits = Math.max(4, Math.min(16, Math.floor(Math.log2(avgSize))));
  const width = strict ? bits + 1 : bits;
  return (0xffff_ffff >>> (32 - width)) >>> 0;
}

/** Deterministic Gear table (256 × u32). */
const GEAR: Uint32Array = (() => {
  const t = new Uint32Array(256);
  let x = 0x9e37_79b9;
  for (let i = 0; i < 256; i++) {
    x = Math.imul(x ^ (x >>> 16), 0x85eb_ca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2_ae35) >>> 0;
    t[i] = (x ^ (x >>> 16)) >>> 0;
  }
  return t;
})();

export function contentDefinedChunk(
  input: Uint8Array,
  options: ChunkingOptions = CHAT_CHUNKING,
): readonly Chunk[] {
  const minSize = options.minSize ?? CHAT_CHUNKING.minSize;
  const avgSize = options.avgSize ?? CHAT_CHUNKING.avgSize;
  const maxSize = options.maxSize ?? CHAT_CHUNKING.maxSize;
  if (minSize < 1 || avgSize < minSize || maxSize < avgSize) {
    throw new Error('invalid chunking options');
  }
  if (input.length === 0) return [];

  const maskStrict = maskForAvg(avgSize, true);
  const maskLax = maskForAvg(avgSize, false);
  const chunks: Chunk[] = [];
  let start = 0;
  let hash = 0;

  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 1) + (GEAR[input[i]!] ?? 0)) >>> 0;
    const size = i - start + 1;
    if (size < minSize) continue;
    const mask = size < avgSize ? maskStrict : maskLax;
    if ((hash & mask) === 0 || size >= maxSize) {
      chunks.push({ offset: start, length: size });
      start = i + 1;
      hash = 0;
    }
  }
  if (start < input.length) {
    chunks.push({ offset: start, length: input.length - start });
  }
  return chunks;
}
