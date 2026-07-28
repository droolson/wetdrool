import { ed25519 } from '@noble/curves/ed25519.js';
import {
  encodeMultibaseBase64Url,
  signingKeyIdFor,
  type IdentityId,
} from '@socially-woke/protocol';
import bs58 from 'bs58';

import {
  relayTopicFor,
  signRelayEvent,
  signSubscription,
  unsignedRelayEventSchema,
  unsignedSubscriptionSchema,
  type RelayAudience,
  type RelayEventKind,
  type SignedRelayEvent,
  type SignedSubscription,
} from '../src/protocol.js';

export const testNow = new Date('2026-07-28T16:00:00.000Z');
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 2));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 3));
const network = `woke:v1:${genesis}:${program}`;

export interface TestIdentity {
  readonly identityId: IdentityId;
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly keyId: string;
}

export const alice = testIdentity(17, 4);
export const bob = testIdentity(31, 5);
export const carol = testIdentity(47, 6);
export const aliceImpersonator = testIdentityForExistingId(79, alice.identityId);
export const publicTopic = relayTopicFor('network:fixture:public');
export const alternateTopic = relayTopicFor('network:fixture:alternate');
export const communityId = objectId('community', 'C');
export const postId = objectId('post', 'P');

let nonceSeed = 1;

export function makeSubscription(
  identity: TestIdentity,
  input: {
    readonly topic?: string;
    readonly kinds?: readonly RelayEventKind[];
    readonly sinceSequence?: number;
    readonly now?: Date;
  } = {},
): SignedSubscription {
  const now = input.now ?? testNow;
  const unsigned = unsignedSubscriptionSchema.parse({
    protocol: 'sociallywoke-relay',
    version: 1,
    action: 'subscribe',
    identity: identity.identityId,
    keyId: identity.keyId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    nonce: nextNonce(),
    subscriptions: [
      {
        topic: input.topic ?? publicTopic,
        kinds: input.kinds ?? [
          'community-update',
          'encrypted-message',
          'live-reaction',
          'livestream-signal',
          'new-post',
          'presence',
          'typing',
        ],
        ...(input.sinceSequence === undefined ? {} : { sinceSequence: input.sinceSequence }),
      },
    ],
    critical: ['relay.expiry.v1'],
    extensions: {},
  });
  return signSubscription(unsigned, identity.privateKey);
}

export function makeEvent(
  kind: RelayEventKind,
  input: {
    readonly identity?: TestIdentity;
    readonly audience?: RelayAudience;
    readonly topic?: string;
    readonly now?: Date;
  } = {},
): SignedRelayEvent {
  const identity = input.identity ?? alice;
  const now = input.now ?? testNow;
  const audience =
    input.audience ??
    (kind === 'typing' || kind === 'encrypted-message'
      ? ({ kind: 'identity', recipients: [bob.identityId] } as const)
      : kind === 'community-update'
        ? ({ kind: 'community', communityId } as const)
        : ({ kind: 'public' } as const));
  const critical = [
    'relay.audience.v1',
    'relay.expiry.v1',
    ...(['encrypted-message', 'livestream-signal'].includes(kind)
      ? (['relay.e2ee.v1'] as const)
      : []),
  ];
  const common = {
    protocol: 'sociallywoke-relay',
    version: 1,
    identity: identity.identityId,
    keyId: identity.keyId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (kind === 'typing' ? 25_000 : 90_000)).toISOString(),
    nonce: nextNonce(),
    topic: input.topic ?? publicTopic,
    audience,
    critical,
    extensions: {},
  } as const;
  const candidate = (() => {
    switch (kind) {
      case 'new-post':
        return {
          ...common,
          kind,
          payload: {
            objectId: postId,
            manifestCid: `b${'a'.repeat(30)}`,
            transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 7)),
            slot: '42',
          },
        };
      case 'typing':
        return {
          ...common,
          kind,
          payload: { state: 'started', contextTag: relayTopicFor('opaque-compose-context') },
        };
      case 'presence':
        return { ...common, kind, payload: { state: 'online' } };
      case 'live-reaction':
        return {
          ...common,
          kind,
          payload: { targetObjectId: postId, reaction: 'care', action: 'add' },
        };
      case 'community-update':
        return {
          ...common,
          kind,
          payload: { communityId, update: 'governance', objectId: objectId('proposal', 'G') },
        };
      case 'encrypted-message':
        return {
          ...common,
          kind,
          payload: {
            messageId: 'message-1',
            mediaType: 'application/socially-woke-e2ee+json',
            cipherSuite: 'x25519-xchacha20-poly1305',
            senderKeyId: identity.keyId,
            ciphertext: encodeMultibaseBase64Url(Uint8Array.from([1, 2, 3, 4])).slice(1),
          },
        };
      case 'livestream-signal':
        return {
          ...common,
          kind,
          payload: {
            sessionId: 'stream-1',
            sequence: 1,
            signalType: 'offer',
            mediaType: 'application/socially-woke-e2ee+json',
            encryptedMetadata: encodeMultibaseBase64Url(Uint8Array.from([5, 6, 7])).slice(1),
          },
        };
    }
  })();
  return signRelayEvent(unsignedRelayEventSchema.parse(candidate), identity.privateKey);
}

export function freshFixtureNonce(): string {
  return nextNonce();
}

function nextNonce(): string {
  const seed = nonceSeed;
  nonceSeed += 1;
  return encodeMultibaseBase64Url(
    Uint8Array.from({ length: 16 }, (_, index) => (seed + index * 29) & 0xff),
  );
}

function testIdentity(seed: number, addressSeed: number): TestIdentity {
  const privateKey = Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 13) & 0xff);
  const publicKey = ed25519.getPublicKey(privateKey);
  const identityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => addressSeed));
  const identityId = `swid:v1:${network}:${identityAddress}` as IdentityId;
  return {
    identityId,
    privateKey,
    publicKey,
    keyId: signingKeyIdFor(identityId, publicKey, 'root'),
  };
}

function testIdentityForExistingId(seed: number, identityId: IdentityId): TestIdentity {
  const privateKey = Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 17) & 0xff);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    identityId,
    privateKey,
    publicKey,
    keyId: signingKeyIdFor(identityId, publicKey, 'root'),
  };
}

function objectId(type: string, character: string): string {
  return `swobj:v1:${type}:u${character.repeat(43)}`;
}
