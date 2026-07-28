import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';

import {
  RelayProtocolError,
  relayTopicFor,
  signRelayEvent,
  unsignedRelayEventSchema,
  verifyRelayEvent,
  verifySubscription,
  type RelayEventKind,
} from '../src/protocol.js';
import {
  alice,
  aliceImpersonator,
  bob,
  communityId,
  freshFixtureNonce,
  makeEvent,
  makeSubscription,
  postId,
  publicTopic,
  testNow,
} from './fixtures.js';

const kinds: readonly RelayEventKind[] = [
  'new-post',
  'typing',
  'presence',
  'live-reaction',
  'community-update',
  'encrypted-message',
  'livestream-signal',
];

describe('signed relay protocol', () => {
  it.each(kinds)('signs and verifies strict %s envelopes', async (kind) => {
    const envelope = makeEvent(kind);
    const verified = await verifyRelayEvent(envelope, { now: testNow });

    expect(verified.envelope).toEqual(envelope);
    expect(verified.eventId).toMatch(/^u[A-Za-z0-9_-]{43}$/u);
    expect(verified.canonicalBytes.byteLength).toBeGreaterThan(100);
  });

  it('rejects the pre-migration Solana identity and signing-key namespaces', () => {
    const message = makeEvent('new-post').message;
    expect(
      unsignedRelayEventSchema.safeParse({
        ...message,
        identity: message.identity.replace(
          'wokesocialid:v1:wokenet:v1:',
          'wokesocialid:v1:solana:',
        ),
        keyId: message.keyId.replace('wokesocialid:v1:wokenet:v1:', 'wokesocialid:v1:solana:'),
      }).success,
    ).toBe(false);
  });

  it('detects payload and signature tampering', async () => {
    const event = makeEvent('new-post');
    const tampered = structuredClone(event);
    if (tampered.message.kind !== 'new-post') {
      throw new Error('fixture kind drift');
    }
    tampered.message.payload.slot = '99';

    await expect(verifyRelayEvent(tampered, { now: testNow })).rejects.toMatchObject({
      code: 'payload-hash-mismatch',
    });

    const badSignature = structuredClone(event);
    badSignature.proof.signature = makeEvent('presence').proof.signature;
    await expect(verifyRelayEvent(badSignature, { now: testNow })).rejects.toMatchObject({
      code: 'invalid-signature',
    });
  });

  it('rejects unknown fields and unknown critical features', async () => {
    const event = makeEvent('presence') as unknown as Record<string, unknown>;
    event['unexpected'] = true;
    await expect(verifyRelayEvent(event, { now: testNow })).rejects.toMatchObject({
      code: 'invalid-envelope',
    });

    const unknownCritical = structuredClone(makeEvent('presence')) as unknown as {
      message: { critical: string[] };
    };
    unknownCritical.message.critical.push('relay.future-feature.v9');
    await expect(verifyRelayEvent(unknownCritical, { now: testNow })).rejects.toMatchObject({
      code: 'invalid-envelope',
    });

    const duplicateCritical = structuredClone(makeEvent('presence').message);
    duplicateCritical.critical.push('relay.audience.v1');
    expect(() => unsignedRelayEventSchema.parse(duplicateCritical)).toThrow();
  });

  it('enforces timestamp freshness, expiry, and lifetime', async () => {
    await expect(
      verifyRelayEvent(makeEvent('presence'), {
        now: new Date(testNow.getTime() + 10 * 60_000),
      }),
    ).rejects.toBeInstanceOf(RelayProtocolError);

    await expect(
      verifyRelayEvent(makeEvent('presence'), {
        now: new Date(testNow.getTime() - 60_000),
      }),
    ).rejects.toMatchObject({ code: 'future-timestamp' });

    const tooLong = structuredClone(makeEvent('new-post'));
    tooLong.message.expiresAt = new Date(testNow.getTime() + 11 * 60_000).toISOString();
    const resigned = signRelayEvent(
      unsignedRelayEventSchema.parse(tooLong.message),
      alice.privateKey,
    );
    await expect(verifyRelayEvent(resigned, { now: testNow })).rejects.toMatchObject({
      code: 'lifetime-too-long',
    });
  });

  it('binds direct and community payloads to their minimal audiences', () => {
    const base = makeEvent('typing').message;
    expect(() =>
      unsignedRelayEventSchema.parse({
        ...base,
        nonce: freshFixtureNonce(),
        audience: { kind: 'public' },
      }),
    ).toThrow();

    const community = makeEvent('community-update').message;
    if (community.kind !== 'community-update') {
      throw new Error('fixture kind drift');
    }
    expect(() =>
      unsignedRelayEventSchema.parse({
        ...community,
        nonce: freshFixtureNonce(),
        audience: { kind: 'community', communityId: postId },
      }),
    ).toThrow();
    expect(community.payload.communityId).toBe(communityId);

    const encrypted = makeEvent('encrypted-message').message;
    if (encrypted.kind !== 'encrypted-message') {
      throw new Error('fixture kind drift');
    }
    expect(() =>
      unsignedRelayEventSchema.parse({
        ...encrypted,
        nonce: freshFixtureNonce(),
        audience: {
          kind: 'identity',
          recipients: [bob.identityId, bob.identityId],
        },
      }),
    ).toThrow();
    expect(() =>
      unsignedRelayEventSchema.parse({
        ...encrypted,
        nonce: freshFixtureNonce(),
        payload: { ...encrypted.payload, senderKeyId: bob.keyId },
      }),
    ).toThrow();
  });

  it('requires key authorization when a deployment supplies an authorizer', async () => {
    const event = makeEvent('new-post');
    await expect(
      verifyRelayEvent(event, {
        now: testNow,
        authorize: ({ identityId, keyId, purpose }) =>
          identityId === alice.identityId && keyId === alice.keyId && purpose === 'new-post',
      }),
    ).resolves.toBeDefined();
    await expect(
      verifyRelayEvent(event, { now: testNow, authorize: () => false }),
    ).rejects.toMatchObject({ code: 'key-not-authorized' });
  });

  it('represents WokeNet slots and Solana-compatible signatures exactly', () => {
    const post = makeEvent('new-post').message;
    if (post.kind !== 'new-post') {
      throw new Error('fixture kind drift');
    }
    expect(post.payload.slot).toBe('42');

    expect(() =>
      unsignedRelayEventSchema.parse({
        ...post,
        nonce: freshFixtureNonce(),
        payload: { ...post.payload, slot: '18446744073709551616' },
      }),
    ).toThrow();
    expect(() =>
      unsignedRelayEventSchema.parse({
        ...post,
        nonce: freshFixtureNonce(),
        payload: {
          ...post.payload,
          transactionSignature: bs58.encode(Uint8Array.from({ length: 63 }, () => 9)),
        },
      }),
    ).toThrow();
  });

  it('authenticates bounded, unique subscription topics', async () => {
    const subscription = makeSubscription(bob);
    await expect(verifySubscription(subscription, { now: testNow })).resolves.toMatchObject({
      envelope: { message: { identity: bob.identityId } },
    });

    const duplicate = structuredClone(subscription.message);
    duplicate.nonce = freshFixtureNonce();
    duplicate.subscriptions.push({
      topic: publicTopic,
      kinds: ['presence'],
    });
    expect(() => makeSubscription(bob)).not.toThrow();
    const { unsignedSubscriptionSchema } = await import('../src/protocol.js');
    expect(() => unsignedSubscriptionSchema.parse(duplicate)).toThrow();

    const duplicateKind = structuredClone(subscription.message);
    duplicateKind.nonce = freshFixtureNonce();
    duplicateKind.subscriptions[0]?.kinds.push('presence');
    expect(() => unsignedSubscriptionSchema.parse(duplicateKind)).toThrow();

    const duplicateSubscriptionCritical = structuredClone(subscription.message);
    duplicateSubscriptionCritical.nonce = freshFixtureNonce();
    duplicateSubscriptionCritical.critical.push('relay.expiry.v1');
    expect(() => unsignedSubscriptionSchema.parse(duplicateSubscriptionCritical)).toThrow();
  });

  it('makes structural key possession explicitly weaker than finalized key authorization', async () => {
    const forged = makeSubscription(aliceImpersonator);
    await expect(verifySubscription(forged, { now: testNow })).resolves.toBeDefined();
    await expect(
      verifySubscription(forged, {
        now: testNow,
        authorize: ({ keyId }) => keyId === alice.keyId,
      }),
    ).rejects.toMatchObject({ code: 'key-not-authorized' });
  });

  it('derives opaque deterministic topics with domain separation', () => {
    expect(relayTopicFor('community:one')).toBe(relayTopicFor('community:one'));
    expect(relayTopicFor('community:one')).not.toBe(relayTopicFor('community:two'));
    expect(() => relayTopicFor('')).toThrow();
  });
});
