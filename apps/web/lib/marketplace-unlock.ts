/**
 * Gate unlock-secret: stored encrypted so it is only returned after x402 payment.
 * Uses AES-GCM with a process key (ephemeral per cold start in alpha).
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

async function gateKey(): Promise<CryptoKey> {
  const g = globalThis as unknown as { __wetdroolGateKey?: CryptoKey };
  if (g.__wetdroolGateKey) return g.__wetdroolGateKey;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  g.__wetdroolGateKey = key;
  return key;
}

export async function wrapUnlockSecret(secret: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await gateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(secret));
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

export async function unwrapUnlockSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await gateKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    key,
    unb64(ciphertext),
  );
  return td.decode(plain);
}
