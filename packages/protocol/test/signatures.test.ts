import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it, vi } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  signPayload,
  signPayloadWithSigner,
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

    expect(verified.objectId).toMatch(/^wetdroolobj:v1:post:/u);
    expect(verified.cid).toMatch(/^bafk/u);
    expect(verified.envelope).toEqual(envelope);
  });

  it('builds the same verified envelope through an operation-scoped detached signer', async () => {
    const signer = vi.fn(
      (request: {
        readonly algorithm: string;
        readonly keyId: string;
        readonly message: Uint8Array;
        readonly purpose: string;
      }) => {
        expect(request).toMatchObject({
          algorithm: 'Ed25519',
          keyId: payload.signingKey,
          purpose: 'wetdrool-portable-object-v1',
        });
        return ed25519.sign(request.message, privateKey);
      },
    );

    const envelope = await signPayloadWithSigner(payload, signer);
    const verified = await verifyEnvelope(envelope, () => true);

    expect(signer).toHaveBeenCalledOnce();
    expect(envelope).toEqual(signPayload(payload, privateKey));
    expect(verified.envelope).toEqual(envelope);
  });

  it('binds an external signature to the exact descriptor and declared key', async () => {
    const wrongPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

    await expect(
      signPayloadWithSigner(payload, ({ message }) => ed25519.sign(message, wrongPrivateKey)),
    ).rejects.toThrow('different bytes or a different key');
    await expect(
      signPayloadWithSigner(payload, ({ message }) => {
        const changed = Uint8Array.from(message);
        changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;
        return ed25519.sign(changed, privateKey);
      }),
    ).rejects.toThrow('different bytes or a different key');
  });

  it('rejects malformed signer output and wraps signer rejection without weakening validation', async () => {
    await expect(signPayloadWithSigner(payload, () => new Uint8Array(63))).rejects.toThrow(
      'invalid Ed25519 signature',
    );
    await expect(
      signPayloadWithSigner(payload, () => {
        throw new Error('device unavailable');
      }),
    ).rejects.toThrow('payload signer rejected');
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
