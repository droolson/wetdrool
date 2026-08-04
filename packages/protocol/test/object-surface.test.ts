import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalize } from 'json-canonicalize';
import { describe, expect, it } from 'vitest';

import {
  authorizationRequirementFor,
  buildDelegationPayload,
  buildPostPayload,
  canonicalizeEnvelope,
  canonicalizeProofDescriptor,
  digestSha256Multibase,
  encodeMultibaseBase64Url,
  PORTABLE_OBJECT_TYPES,
  portablePayloadSchema,
  signPayload,
  SIGNATURE_DOMAIN,
  signingKeyIdFor,
  verifyEnvelope,
  type SignedEnvelope,
} from '../src/index.js';
import { author, identity, privateKey, publicKey } from './fixtures.js';
import {
  createValidPayloads,
  encryptedContentReference,
  fixedOptions,
  objectReference,
  otherIdentity,
} from './object-fixtures.js';

describe('v1 portable object surface', () => {
  it('builds, signs, canonicalizes, and verifies every declared object family', async () => {
    const payloads = createValidPayloads();
    expect(payloads.map((payload) => payload.type)).toEqual(PORTABLE_OBJECT_TYPES);

    for (const payload of payloads) {
      const envelope = signPayload(payload, privateKey);
      const verified = await verifyEnvelope(canonicalizeEnvelope(envelope), () => true);

      expect(verified.envelope.payload.type).toBe(payload.type);
      expect(verified.objectId).toMatch(new RegExp(`^wetdroolobj:v1:${payload.type}:`, 'u'));
      expect(verified.cid).toMatch(/^bafk/u);
    }
  });

  it('binds every object family against post-signature tampering', async () => {
    for (const payload of createValidPayloads()) {
      const envelope = signPayload(payload, privateKey);
      const tampered = {
        ...envelope,
        payload: {
          ...envelope.payload,
          createdAt: '2026-07-28T12:00:00.001Z',
        },
      } as SignedEnvelope;

      await expect(verifyEnvelope(tampered)).rejects.toThrow('Payload hash does not match proof.');
    }
  });

  it('supports encrypted restricted body references without embedding decryption keys', async () => {
    const payload = buildPostPayload(
      identity,
      {
        format: 'plain',
        bodyReference: encryptedContentReference,
        media: [],
        language: 'en',
        contentWarnings: ['restricted'],
        accessibility: {
          altTextReminderAcknowledged: false,
          captionReferences: [],
        },
        visibility: {
          kind: 'restricted',
          policyId: objectReference('community-rule-set').id,
        },
        authorLabels: [],
        replyPolicy: 'none',
        quotePolicy: 'none',
      },
      fixedOptions,
    );

    await expect(verifyEnvelope(signPayload(payload, privateKey))).resolves.toMatchObject({
      envelope: {
        payload: {
          content: {
            bodyReference: {
              protection: {
                kind: 'encrypted',
              },
            },
          },
        },
      },
    });

    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          bodyReference: {
            ...encryptedContentReference,
            protection: {
              ...encryptedContentReference.protection,
              decryptionKey: 'must-never-be-published',
            },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects unknown versions, fields, object types, and unsupported critical extensions', () => {
    const payload = createValidPayloads()[1];
    if (payload === undefined) {
      throw new Error('Expected a post fixture.');
    }

    expect(() => portablePayloadSchema.parse({ ...payload, protocolVersion: '2.0' })).toThrow();
    expect(() => portablePayloadSchema.parse({ ...payload, schemaVersion: 2 })).toThrow();
    expect(() => portablePayloadSchema.parse({ ...payload, type: 'future-object' })).toThrow();
    expect(() => portablePayloadSchema.parse({ ...payload, unexpected: true })).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, futureMeaning: true },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        critical: ['/extensions/example.com.future'],
        extensions: { 'example.com.future': { enabled: true } },
      }),
    ).toThrow(/does not recognize any critical extension/u);
  });

  it('bounds extension bytes and requires JSON-only extension values', () => {
    const payload = createValidPayloads()[1];
    if (payload === undefined) {
      throw new Error('Expected a post fixture.');
    }

    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        extensions: { 'example.com.large': 'x'.repeat(32_769) },
      }),
    ).toThrow(/Extensions exceed/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        extensions: { 'example.com.invalid': BigInt(1) },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        extensions: { 'example.com.invalid': 1.5 },
      }),
    ).toThrow(/interoperable integer/u);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        extensions: { 'example.com.cyclic': cyclic },
      }),
    ).toThrow(/cycle/u);
  });

  it('requires network-bound authors and author-bound signing keys', () => {
    const payload = createValidPayloads()[1];
    if (payload === undefined) {
      throw new Error('Expected a post fixture.');
    }

    expect(() => portablePayloadSchema.parse({ ...payload, author: otherIdentity })).toThrow(
      /signing key must belong/u,
    );
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        network: payload.network.replace(/.$/u, '2'),
      }),
    ).toThrow();
  });
});

describe('object authorization policy', () => {
  it('declares scopes and external checks for every object type', () => {
    for (const objectType of PORTABLE_OBJECT_TYPES) {
      const requirement = authorizationRequirementFor(objectType);
      expect(requirement.scopes.length).toBeGreaterThan(0);
      expect(requirement.externalChecks).toContain('key-authorized-at-created-at');
      expect(requirement.externalChecks).toContain('key-not-revoked');
    }
  });

  it('requires a root signature for delegation objects', () => {
    const delegateKey = signingKeyIdFor(
      author,
      Uint8Array.from(publicKey, (value) => value ^ 0xff),
      'delegation',
    );
    const delegatedIdentity = {
      ...identity,
      signingKey: signingKeyIdFor(author, publicKey, 'delegation'),
    };
    const delegation = buildDelegationPayload(
      delegatedIdentity,
      {
        delegateKey,
        scopes: ['content.publish'],
        validity: { startsAt: '2026-07-28T12:00:00.000Z' },
        rootRotation: 0,
      },
      fixedOptions,
    );

    expect(() => signPayload(delegation, privateKey)).toThrow(
      'delegation objects must be signed by an identity root key',
    );
  });

  it('requires a root signature for community objects', () => {
    expect(authorizationRequirementFor('community')).toMatchObject({
      signing: 'root-only',
      scopes: ['community.create'],
    });
    const community = createValidPayloads().find(({ type }) => type === 'community');
    if (community === undefined) {
      throw new Error('Expected a community fixture.');
    }
    const delegatedCommunity = {
      ...community,
      signingKey: signingKeyIdFor(author, publicKey, 'delegation'),
    };

    expect(() => signPayload(delegatedCommunity, privateKey)).toThrow(
      'community objects must be signed by an identity root key',
    );
  });

  it('continues to verify frozen schema-v1 communities signed by a delegated key', async () => {
    const currentCommunity = createValidPayloads().find(({ type }) => type === 'community');
    if (
      currentCommunity === undefined ||
      currentCommunity.type !== 'community' ||
      currentCommunity.schemaVersion !== 2
    ) {
      throw new Error('Expected a community fixture.');
    }
    const legacyCommunity = portablePayloadSchema.parse({
      ...currentCommunity,
      schemaVersion: 1,
      signingKey: signingKeyIdFor(author, publicKey, 'delegation'),
      content: {
        slug: currentCommunity.content.slug,
        name: currentCommunity.content.name,
        description: currentCommunity.content.description,
        visibility: currentCommunity.content.visibility,
        membershipPolicy: currentCommunity.content.membershipPolicy,
        governanceModel: 'one-member-one-vote',
        governanceThreshold: { kind: 'simple-majority' },
        governanceQuorum: { kind: 'members', minimum: '10' },
        federationPolicy: currentCommunity.content.federationPolicy,
        replacement: currentCommunity.content.replacement,
      },
    });
    expect(authorizationRequirementFor(legacyCommunity).signing).toBe('root-or-delegation');
    const serialized = canonicalize(legacyCommunity);
    if (serialized === undefined) {
      throw new Error('Expected a canonical legacy community payload.');
    }
    const payloadHash = digestSha256Multibase(new TextEncoder().encode(serialized));
    const signature = ed25519.sign(
      canonicalizeProofDescriptor({
        domain: SIGNATURE_DOMAIN,
        version: 1,
        algorithm: 'Ed25519',
        keyId: legacyCommunity.signingKey,
        network: legacyCommunity.network,
        objectType: legacyCommunity.type,
        payloadHash,
      }),
      privateKey,
    );

    await expect(
      verifyEnvelope({
        payload: legacyCommunity,
        proof: {
          algorithm: 'Ed25519',
          keyId: legacyCommunity.signingKey,
          payloadHash,
          signature: encodeMultibaseBase64Url(signature),
        },
      }),
    ).resolves.toMatchObject({
      envelope: { payload: { type: 'community', schemaVersion: 1 } },
    });
  });

  it('rejects a cryptographically valid delegated-key delegation during verification', async () => {
    const delegateKey = signingKeyIdFor(
      author,
      Uint8Array.from(publicKey, (value) => value ^ 0xff),
      'delegation',
    );
    const delegation = buildDelegationPayload(
      identity,
      {
        delegateKey,
        scopes: ['content.publish'],
        validity: { startsAt: '2026-07-28T12:00:00.000Z' },
        rootRotation: 0,
      },
      fixedOptions,
    );
    const serialized = canonicalize(delegation);
    if (serialized === undefined) {
      throw new Error('Expected a canonical delegation payload.');
    }
    const payloadHash = digestSha256Multibase(new TextEncoder().encode(serialized));
    const signature = ed25519.sign(
      canonicalizeProofDescriptor({
        domain: SIGNATURE_DOMAIN,
        version: 1,
        algorithm: 'Ed25519',
        keyId: delegation.signingKey,
        network: delegation.network,
        objectType: delegation.type,
        payloadHash,
      }),
      privateKey,
    );

    await expect(
      verifyEnvelope({
        payload: delegation,
        proof: {
          algorithm: 'Ed25519',
          keyId: delegation.signingKey,
          payloadHash,
          signature: encodeMultibaseBase64Url(signature),
        },
      }),
    ).rejects.toThrow('delegation objects must be signed by an identity root key');
  });

  it('passes the full object and enforcement requirements to an external authorizer', async () => {
    const payload = createValidPayloads().find(({ type }) => type === 'governance-vote');
    if (payload === undefined) {
      throw new Error('Expected a governance vote fixture.');
    }
    const envelope = signPayload(payload, privateKey);

    await expect(
      verifyEnvelope(envelope, (context) => {
        expect(context.payload).toEqual(payload);
        expect(context.objectId).toMatch(/^wetdroolobj:v1:governance-vote:/u);
        expect(context.requirement.scopes).toEqual(['governance.vote']);
        expect(context.requirement.externalChecks).toContain('vote-eligibility-and-weight');
        return false;
      }),
    ).rejects.toThrow('Signing key was not authorized');
  });
});
