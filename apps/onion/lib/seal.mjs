/**
 * Passphrase-sealed messages for JS-free onion UI.
 *
 * Server derives a key from (roomId + passphrase), encrypts with AES-256-GCM,
 * stores ciphertext only. Passphrase is never persisted.
 *
 * Honest boundary: this is *passphrase-sealed at rest*. During a single request
 * the server briefly sees plaintext to render no-JS HTML. True browser E2EE
 * requires client crypto (use clearnet /rooms with JS). Tor still hides path
 * and IP from clearnet observers.
 */

import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

const PROTOCOL = 'wetdrool.onion.seal.v1';
const ITERATIONS = 210_000;

export function normalizeRoomId(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

function deriveKey(roomId, passphrase) {
  const salt = Buffer.from(`wetdrool.onion.v1:${roomId}`, 'utf8');
  return pbkdf2Sync(String(passphrase), salt, ITERATIONS, 32, 'sha256');
}

export function sealText(roomId, passphrase, text) {
  const key = deriveKey(roomId, passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(String(text), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    protocol: PROTOCOL,
    roomId,
    messageId: randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
    contentType: 'text/plain; charset=utf-8',
    kind: 'text',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function sealMedia(roomId, passphrase, bytes, contentType, kind) {
  const key = deriveKey(roomId, passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    protocol: PROTOCOL,
    roomId,
    messageId: randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
    contentType: String(contentType || 'application/octet-stream').slice(0, 128),
    kind: kind || 'media',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function openEnvelope(passphrase, env) {
  if (!env || env.protocol !== PROTOCOL) throw new Error('bad protocol');
  const key = deriveKey(env.roomId, passphrase);
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const ct = Buffer.from(env.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return { bytes: pt, contentType: env.contentType, kind: env.kind };
}

export function contentHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
