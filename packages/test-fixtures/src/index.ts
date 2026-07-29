import {
  buildPostPayload,
  buildProfilePayload,
  buildTombstonePayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  getObjectId,
  legacyProfilePayloadSchema,
  signPayload,
  signedEnvelopeSchema,
  type NetworkId,
  type PayloadBuilderIdentity,
  type SignedEnvelope,
} from '@wokesocial/protocol';

export const TEST_FIXTURE_WARNING =
  'PUBLIC TEST KEY MATERIAL — NEVER USE FOR FUNDS, PRODUCTION IDENTITIES, OR TRUST DECISIONS.';

export const FIXTURE_NETWORK =
  'wokenet:v1:US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx:YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf' as NetworkId;
export const FIXTURE_CREATED_AT = '2026-07-28T12:00:00.000Z';

const ALICE_AUTHOR = `wokesocialid:v1:${FIXTURE_NETWORK}:cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN`;
const BOB_AUTHOR = `wokesocialid:v1:${FIXTURE_NETWORK}:gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5`;

const ALICE_PRIVATE_KEY = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32,
] as const;
const ALICE_PUBLIC_KEY = [
  121, 181, 86, 46, 143, 230, 84, 249, 64, 120, 177, 18, 232, 169, 139, 167, 144, 31, 133, 58, 230,
  149, 190, 215, 224, 227, 145, 11, 173, 4, 150, 100,
] as const;
const BOB_PRIVATE_KEY = [
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  57, 58, 59, 60, 61, 62, 63, 64,
] as const;
const BOB_PUBLIC_KEY = [
  231, 241, 98, 161, 11, 236, 85, 154, 254, 161, 149, 228, 220, 232, 75, 105, 86, 141, 93, 44, 176,
  150, 62, 180, 70, 192, 104, 94, 43, 23, 242, 240,
] as const;

export type FixtureParticipantName = 'alice' | 'bob';

export interface FixtureParticipant {
  readonly name: FixtureParticipantName;
  readonly author: string;
  /** Intentionally public, deterministic test material returned as a fresh copy. */
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly identity: PayloadBuilderIdentity;
}

export interface CanonicalManifestFixture {
  readonly envelope: SignedEnvelope;
  readonly canonicalBytes: Uint8Array;
  readonly objectId: string;
}

export interface ProtocolFixtureSet {
  readonly network: NetworkId;
  readonly createdAt: string;
  readonly warning: typeof TEST_FIXTURE_WARNING;
  readonly participants: {
    readonly alice: FixtureParticipant;
    readonly bob: FixtureParticipant;
  };
  readonly manifests: {
    /** Frozen, previously published schema-version-1 profile vector. */
    readonly aliceProfileV1: CanonicalManifestFixture;
    readonly aliceProfile: CanonicalManifestFixture;
    readonly bobProfile: CanonicalManifestFixture;
    readonly alicePost: CanonicalManifestFixture;
    readonly bobReply: CanonicalManifestFixture;
    readonly bobReplyTombstone: CanonicalManifestFixture;
  };
}

function nonce(firstByte: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, index) => (firstByte + index) & 0xff);
}

function participant(
  name: FixtureParticipantName,
  author: string,
  privateKey: readonly number[],
  publicKey: readonly number[],
): FixtureParticipant {
  const privateKeyBytes = Uint8Array.from(privateKey);
  const publicKeyBytes = Uint8Array.from(publicKey);
  return {
    name,
    author,
    privateKey: privateKeyBytes,
    publicKey: publicKeyBytes,
    identity: createPayloadBuilderIdentity(FIXTURE_NETWORK, author, publicKeyBytes),
  };
}

function canonicalManifest(envelope: SignedEnvelope): CanonicalManifestFixture {
  return {
    envelope,
    canonicalBytes: canonicalizeEnvelope(envelope),
    objectId: getObjectId(envelope.payload),
  };
}

function legacyAliceProfileV1(): CanonicalManifestFixture {
  const signingKey = `${ALICE_AUTHOR}#delegation/9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj`;
  return canonicalManifest(
    signedEnvelopeSchema.parse({
      payload: legacyProfilePayloadSchema.parse({
        protocol: 'wokesocial',
        protocolVersion: '1.0',
        schemaVersion: 1,
        network: FIXTURE_NETWORK,
        author: ALICE_AUTHOR,
        signingKey,
        createdAt: FIXTURE_CREATED_AT,
        nonce: 'uAQIDBAUGBwgJCgsMDQ4PEA',
        critical: [],
        extensions: {},
        type: 'profile',
        content: {
          displayName: 'Alice Example',
          bio: 'Building kinder, user-owned social spaces.',
          pronouns: [{ value: 'she/her', visibility: 'public' }],
          genderVisibility: 'private',
          chosenFamilyLabels: [],
          links: [{ label: 'Protocol notes', url: 'https://example.com/alice/protocol' }],
        },
      }),
      proof: {
        algorithm: 'Ed25519',
        keyId: signingKey,
        payloadHash: 'uXkdJJqsNndfcFsSA9vg-NFqZgNm-xi5E3Pf0wdgvhVY',
        signature:
          'umdvdTfB6_danFf7Eu8A_K8TJAWPu_9dQHe0QyDQBbecSgE4kxX6NfHP70AtGkRSVKfbry6KQXbPDNyg9JW-dDQ',
      },
    }),
  );
}

/**
 * Builds fresh fixture objects so mutation in one test cannot contaminate
 * another. All timestamps, nonces, identities, and signing seeds are fixed.
 */
export function createProtocolFixtureSet(): ProtocolFixtureSet {
  const alice = participant('alice', ALICE_AUTHOR, ALICE_PRIVATE_KEY, ALICE_PUBLIC_KEY);
  const bob = participant('bob', BOB_AUTHOR, BOB_PRIVATE_KEY, BOB_PUBLIC_KEY);
  const createdAt = new Date(FIXTURE_CREATED_AT);

  const aliceProfile = canonicalManifest(
    signPayload(
      buildProfilePayload(
        alice.identity,
        {
          displayName: 'Alice Example',
          bio: 'Building kinder, user-owned social spaces.',
          pronouns: [{ visibility: 'public', value: 'she/her' }],
          chosenFamilyLabels: [],
          links: [{ label: 'Protocol notes', url: 'https://example.com/alice/protocol' }],
        },
        { createdAt, nonce: nonce(1) },
      ),
      alice.privateKey,
    ),
  );
  const bobProfile = canonicalManifest(
    signPayload(
      buildProfilePayload(
        bob.identity,
        {
          displayName: 'Bob Example',
          bio: 'Testing portable conversations.',
          pronouns: [{ visibility: 'public', value: 'they/them' }],
          chosenFamilyLabels: [],
          links: [],
        },
        { createdAt, nonce: nonce(17) },
      ),
      bob.privateKey,
    ),
  );
  const alicePost = canonicalManifest(
    signPayload(
      buildPostPayload(
        alice.identity,
        {
          format: 'plain',
          body: 'Portable social data should remain verifiable across providers.',
          media: [],
          language: 'en',
          contentWarnings: [],
          accessibility: {
            altTextReminderAcknowledged: false,
            captionReferences: [],
          },
          visibility: { kind: 'public' },
          authorLabels: [],
          replyPolicy: 'anyone',
          quotePolicy: 'allowed',
        },
        { createdAt, nonce: nonce(33) },
      ),
      alice.privateKey,
    ),
  );
  const bobReply = canonicalManifest(
    signPayload(
      buildPostPayload(
        bob.identity,
        {
          format: 'plain',
          body: 'And signatures let every provider verify who published it.',
          media: [],
          replyTo: { id: alicePost.objectId },
          language: 'en',
          contentWarnings: [],
          accessibility: {
            altTextReminderAcknowledged: false,
            captionReferences: [],
          },
          visibility: { kind: 'public' },
          authorLabels: [],
          replyPolicy: 'anyone',
          quotePolicy: 'allowed',
        },
        { createdAt, nonce: nonce(49) },
      ),
      bob.privateKey,
    ),
  );
  const bobReplyTombstone = canonicalManifest(
    signPayload(
      buildTombstonePayload(
        bob.identity,
        {
          target: { id: bobReply.objectId },
          reason: 'author-deleted',
          explanation: 'Deterministic deletion fixture.',
        },
        { createdAt, nonce: nonce(65) },
      ),
      bob.privateKey,
    ),
  );

  return {
    network: FIXTURE_NETWORK,
    createdAt: FIXTURE_CREATED_AT,
    warning: TEST_FIXTURE_WARNING,
    participants: { alice, bob },
    manifests: {
      aliceProfileV1: legacyAliceProfileV1(),
      aliceProfile,
      bobProfile,
      alicePost,
      bobReply,
      bobReplyTombstone,
    },
  };
}
