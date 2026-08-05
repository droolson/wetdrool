/**
 * Client-side E2EE seal for WetDrool rooms.
 * Flow: plaintext → middle-out-lite compress → AES-256-GCM with room key.
 * Server stores ciphertext only.
 */

import {
  decodeMiddleOutLite,
  encodeMiddleOutLite,
  frameFromBytes,
  frameToBytes,
  type PayloadKind,
} from './middle-out';

const te = new TextEncoder();
const td = new TextDecoder();

export const SEAL_PROTOCOL = 'wetdrool.e2ee.middle-out.v1' as const;

export interface SealedEnvelope {
  readonly protocol: typeof SEAL_PROTOCOL;
  readonly roomId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly contentType: string;
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
  readonly compression: 'middle-out-lite-v1';
  /**
   * Optional public display name only (not a login). Content stays E2EE.
   * Max 32 chars; stripped of control characters.
   */
  readonly from?: string;
}

export function normalizeUsername(raw: string): string {
  const t = raw
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 32);
  return t.length > 0 ? t : 'anon';
}

function b64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto BufferSource + TS strict). */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function deriveRoomKey(
  roomId: string,
  passphrase: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    te.encode(`wetdrool-room-v1:${roomId}:${passphrase}`),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: te.encode(`wetdrool.salt.v1:${roomId}`),
      iterations: 210_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealBytes(
  roomId: string,
  passphrase: string,
  plaintext: Uint8Array,
  contentType: string,
  kind: PayloadKind = 'bytes',
  from?: string,
): Promise<SealedEnvelope> {
  const frame = await encodeMiddleOutLite(plaintext, kind, contentType);
  const frameBytes = asBufferSource(frameToBytes(frame));
  const key = await deriveRoomKey(roomId, passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, frameBytes);
  const display = from !== undefined ? normalizeUsername(from) : undefined;
  return {
    protocol: SEAL_PROTOCOL,
    roomId,
    messageId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    contentType,
    ivBase64: b64(iv),
    ciphertextBase64: b64(new Uint8Array(ct)),
    compression: 'middle-out-lite-v1',
    ...(display !== undefined ? { from: display } : {}),
  };
}

export async function sealText(
  roomId: string,
  passphrase: string,
  text: string,
  from?: string,
): Promise<SealedEnvelope> {
  return sealBytes(
    roomId,
    passphrase,
    te.encode(text),
    'text/plain; charset=utf-8',
    'text',
    from,
  );
}

export type OpenEnvelopeErrorCode =
  | 'unsupported_protocol'
  | 'wrong_key'
  | 'corrupt'
  | 'invalid_encoding';

export class OpenEnvelopeError extends Error {
  readonly code: OpenEnvelopeErrorCode;

  constructor(code: OpenEnvelopeErrorCode, message: string) {
    super(message);
    this.name = 'OpenEnvelopeError';
    this.code = code;
  }
}

function isCryptoOperationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  // WebCrypto AES-GCM auth failure is OperationError in browsers and Node.
  return name === 'OperationError' || name === 'DOMException';
}

export async function openEnvelope(
  passphrase: string,
  envelope: SealedEnvelope,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }> {
  if (envelope.protocol !== SEAL_PROTOCOL) {
    throw new OpenEnvelopeError('unsupported_protocol', 'unsupported seal protocol');
  }
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    iv = asBufferSource(unb64(envelope.ivBase64));
    ct = asBufferSource(unb64(envelope.ciphertextBase64));
  } catch {
    throw new OpenEnvelopeError('invalid_encoding', 'envelope base64 encoding is invalid');
  }
  if (iv.byteLength !== 12) {
    throw new OpenEnvelopeError('corrupt', 'envelope IV length is invalid');
  }
  const key = await deriveRoomKey(envelope.roomId, passphrase);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch (err) {
    if (isCryptoOperationError(err)) {
      throw new OpenEnvelopeError(
        'wrong_key',
        'decryption failed — wrong room key or tampered ciphertext',
      );
    }
    throw new OpenEnvelopeError('corrupt', 'decryption failed');
  }
  try {
    const frame = frameFromBytes(new Uint8Array(plain));
    const bytes = await decodeMiddleOutLite(frame);
    return { bytes, contentType: envelope.contentType };
  } catch {
    throw new OpenEnvelopeError('corrupt', 'decompressed frame is corrupt');
  }
}

export async function openText(passphrase: string, envelope: SealedEnvelope): Promise<string> {
  const { bytes } = await openEnvelope(passphrase, envelope);
  return td.decode(bytes);
}

/** Human-readable copy for room UI (wrong key vs corrupt vs other). */
export function describeOpenError(err: unknown): { readonly code: OpenEnvelopeErrorCode | 'unknown'; readonly message: string } {
  if (err instanceof OpenEnvelopeError) {
    switch (err.code) {
      case 'wrong_key':
        return {
          code: err.code,
          message: 'Wrong room key — this message was sealed with a different passphrase.',
        };
      case 'unsupported_protocol':
        return { code: err.code, message: 'Unsupported seal protocol version.' };
      case 'invalid_encoding':
        return { code: err.code, message: 'Message encoding is invalid.' };
      case 'corrupt':
        return { code: err.code, message: 'Corrupt or unreadable sealed payload.' };
      default:
        return { code: err.code, message: err.message };
    }
  }
  return { code: 'unknown', message: 'Could not open sealed message.' };
}
