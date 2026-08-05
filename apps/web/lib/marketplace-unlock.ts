/**
 * Gate unlock-secret: stored encrypted so it is only returned after x402 payment.
 *
 * Prefer WETDROOL_MARKETPLACE_GATE_SECRET (≥16 chars) so file-backed listings
 * remain unlockable after process restart. Without it, a fresh random key is
 * used per cold start (memory-ephemeral alpha only).
 */

const te = new TextEncoder();
const td = new TextDecoder();

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

/** Fresh ArrayBuffer-backed view for WebCrypto BufferSource under strict TS. */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export type MarketplaceGateMode = 'env-stable' | 'ephemeral';

export function getMarketplaceGateMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MarketplaceGateMode {
  const secret = env.WETDROOL_MARKETPLACE_GATE_SECRET?.trim() ?? '';
  return secret.length >= 16 ? 'env-stable' : 'ephemeral';
}

async function materializeKeyBytes(
  env: Readonly<Record<string, string | undefined>>,
): Promise<Uint8Array> {
  const secret = env.WETDROOL_MARKETPLACE_GATE_SECRET?.trim() ?? '';
  if (secret.length >= 16) {
    const digest = await crypto.subtle.digest('SHA-256', te.encode(`wetdrool.market.gate.v1:${secret}`));
    return new Uint8Array(digest);
  }
  return crypto.getRandomValues(new Uint8Array(32));
}

async function gateKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CryptoKey> {
  const g = globalThis as unknown as { __wetdroolGateKey?: CryptoKey; __wetdroolGateMode?: string };
  const mode = getMarketplaceGateMode(env);
  if (g.__wetdroolGateKey && g.__wetdroolGateMode === mode && env === process.env) {
    return g.__wetdroolGateKey;
  }
  const raw = await materializeKeyBytes(env);
  const key = await crypto.subtle.importKey('raw', asBufferSource(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  if (env === process.env) {
    g.__wetdroolGateKey = key;
    g.__wetdroolGateMode = mode;
  }
  return key;
}

/** Test helper. */
export function resetMarketplaceGateCache(): void {
  const g = globalThis as unknown as { __wetdroolGateKey?: CryptoKey; __wetdroolGateMode?: string };
  delete g.__wetdroolGateKey;
  delete g.__wetdroolGateMode;
}

export async function wrapUnlockSecret(
  secret: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await gateKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    asBufferSource(te.encode(secret)),
  );
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

export async function unwrapUnlockSecret(
  ciphertext: string,
  iv: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const key = await gateKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(unb64(iv)) },
    key,
    asBufferSource(unb64(ciphertext)),
  );
  return td.decode(plain);
}
