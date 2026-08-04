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
  const frameBytes = frameToBytes(frame);
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

export async function openEnvelope(
  passphrase: string,
  envelope: SealedEnvelope,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }> {
  if (envelope.protocol !== SEAL_PROTOCOL) {
    throw new Error('unsupported seal protocol');
  }
  const key = await deriveRoomKey(envelope.roomId, passphrase);
  const iv = unb64(envelope.ivBase64);
  const ct = unb64(envelope.ciphertextBase64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const frame = frameFromBytes(new Uint8Array(plain));
  const bytes = await decodeMiddleOutLite(frame);
  return { bytes, contentType: envelope.contentType };
}

export async function openText(passphrase: string, envelope: SealedEnvelope): Promise<string> {
  const { bytes } = await openEnvelope(passphrase, envelope);
  return td.decode(bytes);
}
