import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  canonicalizePayload,
  decodeCanonicalEnvelope,
  getEnvelopeCid,
  getObjectId,
  ProtocolValidationError,
  signPayload,
} from '../src/index.js';
import { identity, postContent, privateKey } from './fixtures.js';

const createdAt = new Date('2026-07-28T12:00:00.000Z');
const nonce = Uint8Array.from({ length: 16 }, (_, index) => index);

describe('canonical protocol objects', () => {
  it('produces deterministic bytes and object IDs', () => {
    const first = buildPostPayload(identity, postContent, { createdAt, nonce });
    const second = buildPostPayload(identity, postContent, { createdAt, nonce });

    expect(canonicalizePayload(first)).toEqual(canonicalizePayload(second));
    expect(getObjectId(first)).toBe(getObjectId(second));
    expect(getObjectId(first)).toMatch(/^wetdroolobj:v1:post:u[A-Za-z0-9_-]{43}$/u);
  });

  it('preserves the canonical DroolNet v1 post golden vector', async () => {
    const payload = buildPostPayload(identity, postContent, { createdAt, nonce });
    const envelope = signPayload(payload, privateKey);

    expect(getObjectId(payload)).toBe(
      'wetdroolobj:v1:post:uI2G7vVX5Pxdh6giJ7Zyv8sVQ4-Xz-CK5J_plklQMXbQ',
    );
    expect(envelope.proof.payloadHash).toBe('uI2G7vVX5Pxdh6giJ7Zyv8sVQ4-Xz-CK5J_plklQMXbQ');
    expect(envelope.proof.signature).toBe(
      'uwBHiXYbzYlSwNGxNBvwzGFdSHgl9dY1J9NX2S9Q-xMMeijgLHVwmVQuNe2_AjiL5l0XUrAvNit57yD-ifRKzAA',
    );
    await expect(getEnvelopeCid(envelope)).resolves.toBe(
      'bafkreid3nexv57bjwmp6wvax5fbfexuovegi27saevauhqs6uon6d7oiiy',
    );
  });

  it('rejects non-NFC user-visible strings', () => {
    const payload = buildPostPayload(
      identity,
      { ...postContent, body: 'Cafe\u0301' },
      { createdAt, nonce },
    );

    expect(() => canonicalizePayload(payload)).toThrow(ProtocolValidationError);
  });

  it('accepts only exact canonical envelope bytes', () => {
    const payload = buildPostPayload(identity, postContent, { createdAt, nonce });
    const envelope = signPayload(payload, privateKey);
    const bytes = canonicalizeEnvelope(envelope);

    expect(decodeCanonicalEnvelope(bytes)).toEqual(envelope);

    const pretty = new TextEncoder().encode(JSON.stringify(envelope, undefined, 2));
    expect(() => decodeCanonicalEnvelope(pretty)).toThrow(
      'Envelope bytes are not the canonical representation.',
    );
  });
});
