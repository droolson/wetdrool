import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  signPayload,
  signedEnvelopeSchema,
  verifyEnvelope,
  type SignedEnvelope,
} from '../src/index.js';
import { identity, postContent, privateKey } from './fixtures.js';

const payload = buildPostPayload(identity, postContent, {
  createdAt: new Date('2026-07-28T12:00:00.000Z'),
  nonce: Uint8Array.from({ length: 16 }, (_, index) => index),
});

describe('signed envelopes', () => {
  it('verifies a canonical Ed25519 envelope', async () => {
    const envelope = signPayload(payload, privateKey);
    const verified = await verifyEnvelope(canonicalizeEnvelope(envelope), () => true);

    expect(verified.objectId).toMatch(/^wokesocialobj:v1:post:/u);
    expect(verified.cid).toMatch(/^bafk/u);
    expect(verified.envelope).toEqual(envelope);
  });

  it('rejects a payload changed after signing', async () => {
    const envelope = signPayload(payload, privateKey);
    if (envelope.payload.type !== 'post') {
      throw new Error('Expected a post fixture.');
    }
    const changed = signedEnvelopeSchema.parse({
      ...envelope,
      payload: {
        ...envelope.payload,
        content: {
          ...envelope.payload.content,
          body: 'A different post.',
        },
      },
    });

    await expect(verifyEnvelope(changed)).rejects.toThrow('Payload hash does not match proof.');
  });

  it('requires an authorization decision when supplied', async () => {
    const envelope = signPayload(payload, privateKey);
    await expect(verifyEnvelope(envelope, () => false)).rejects.toThrow(
      'Signing key was not authorized',
    );
  });

  it('strictly validates proof metadata supplied through the object API', async () => {
    const envelope = signPayload(payload, privateKey);
    const unsupportedAlgorithm = {
      ...envelope,
      proof: {
        ...envelope.proof,
        algorithm: 'not-ed25519',
      },
    } as unknown as SignedEnvelope;
    const unknownProofField = {
      ...envelope,
      proof: {
        ...envelope.proof,
        verifierHint: 'ignore-signature',
      },
    } as unknown as SignedEnvelope;

    await expect(verifyEnvelope(unsupportedAlgorithm)).rejects.toThrow();
    await expect(verifyEnvelope(unknownProofField)).rejects.toThrow();
  });
});
