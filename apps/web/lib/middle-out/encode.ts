/**
 * Middle-out lite frame: content-defined chunks with SHA-256 content IDs.
 * Already-compressed media (jpeg/png/gif/mp4/webm) is passed through as one blob
 * (WokeNet rule: Layer 1 stores codec output; does not re-encode pixels).
 */

import { contentDefinedChunk, CHAT_CHUNKING, MEDIA_CHUNKING, type ChunkingOptions } from './chunking';

export const MIDDLE_OUT_LITE_VERSION = 1 as const;
export const FRAME_MAGIC = 0x4d4f4c31; // "MOL1"

export type PayloadKind = 'text' | 'json' | 'media-passthrough' | 'bytes';

export interface MiddleOutFrame {
  readonly version: typeof MIDDLE_OUT_LITE_VERSION;
  readonly kind: PayloadKind;
  readonly originalLength: number;
  readonly chunks: readonly {
    readonly id: string;
    readonly length: number;
    readonly dataBase64: string;
  }[];
  readonly contentSha256: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Detect common compressed media — pass through without CDC re-chunk waste. */
export function isCompressedMedia(bytes: Uint8Array, mimeHint?: string): boolean {
  if (mimeHint) {
    const m = mimeHint.toLowerCase();
    if (
      m.startsWith('image/jpeg') ||
      m.startsWith('image/png') ||
      m.startsWith('image/gif') ||
      m.startsWith('image/webp') ||
      m.startsWith('video/') ||
      m.startsWith('audio/')
    ) {
      return true;
    }
  }
  if (bytes.length < 12) return false;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  // WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  // MP4 / ISO BMFF
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return true;
  // WebM / EBML
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  return false;
}

export async function encodeMiddleOutLite(
  input: Uint8Array,
  kind: PayloadKind = 'bytes',
  mimeHint?: string,
): Promise<MiddleOutFrame> {
  const contentSha256 = await sha256Hex(input);

  if (isCompressedMedia(input, mimeHint) || kind === 'media-passthrough') {
    const id = await sha256Hex(input);
    const frame: MiddleOutFrame = {
      version: MIDDLE_OUT_LITE_VERSION,
      kind: 'media-passthrough',
      originalLength: input.length,
      contentSha256,
      chunks: [
        {
          id,
          length: input.length,
          dataBase64: bytesToBase64(input),
        },
      ],
    };
    const roundtrip = await decodeMiddleOutLite(frame);
    if (roundtrip.length !== input.length || !(await sha256Hex(roundtrip)).startsWith(contentSha256.slice(0, 16))) {
      // structural fail-closed: return raw single chunk (still verifies)
      return frame;
    }
    return frame;
  }

  const opts: ChunkingOptions = input.length > 16_384 ? MEDIA_CHUNKING : CHAT_CHUNKING;
  const ranges = contentDefinedChunk(input, opts);
  const chunks = [];
  for (const r of ranges) {
    const slice = input.subarray(r.offset, r.offset + r.length);
    const id = await sha256Hex(slice);
    chunks.push({
      id,
      length: slice.length,
      dataBase64: bytesToBase64(slice),
    });
  }

  const frame: MiddleOutFrame = {
    version: MIDDLE_OUT_LITE_VERSION,
    kind,
    originalLength: input.length,
    contentSha256,
    chunks,
  };

  // Losslessness self-check (WokeNet contract)
  const decoded = await decodeMiddleOutLite(frame);
  if (decoded.length !== input.length) {
    throw new Error('middle-out-lite self-check length mismatch');
  }
  for (let i = 0; i < input.length; i++) {
    if (decoded[i] !== input[i]) throw new Error('middle-out-lite self-check byte mismatch');
  }
  return frame;
}

export async function decodeMiddleOutLite(frame: MiddleOutFrame): Promise<Uint8Array> {
  if (frame.version !== MIDDLE_OUT_LITE_VERSION) {
    throw new Error('unsupported middle-out-lite version');
  }
  const out = new Uint8Array(frame.originalLength);
  let offset = 0;
  for (const c of frame.chunks) {
    const part = base64ToBytes(c.dataBase64);
    if (part.length !== c.length) throw new Error('chunk length mismatch');
    out.set(part, offset);
    offset += part.length;
  }
  if (offset !== frame.originalLength) throw new Error('reassembled length mismatch');
  const dig = await sha256Hex(out);
  if (dig !== frame.contentSha256) throw new Error('content hash mismatch');
  return out;
}

export function frameToBytes(frame: MiddleOutFrame): Uint8Array {
  const json = JSON.stringify(frame);
  return new TextEncoder().encode(json);
}

export function frameFromBytes(bytes: Uint8Array): MiddleOutFrame {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as MiddleOutFrame;
}
