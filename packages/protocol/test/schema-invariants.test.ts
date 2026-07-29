import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  currentPortablePayloadSchema,
  identityIdSchema,
  networkIdSchema,
  portablePayloadSchema,
  signPayload,
  signingKeyIdSchema,
  tokenAmountSchema,
  transactionSignatureSchema,
  type PayloadForType,
  type PortablePayloadType,
  unsigned64Schema,
} from '../src/index.js';
import { author, network, privateKey } from './fixtures.js';
import {
  createValidPayloads,
  encryptedContentReference,
  objectReference,
  otherIdentity,
} from './object-fixtures.js';

function payloadOf<Type extends PortablePayloadType>(type: Type): PayloadForType<Type> {
  const payload = createValidPayloads().find((candidate) => candidate.type === type);
  if (payload === undefined) {
    throw new Error(`Missing ${type} fixture.`);
  }
  return payload as PayloadForType<Type>;
}

describe('object-specific validation invariants', () => {
  it('keeps profile v1 read-only while requiring profile v2 for current creation', () => {
    const current = payloadOf('profile');
    const legacy = {
      ...current,
      schemaVersion: 1,
      content: {
        displayName: current.content.displayName,
        bio: current.content.bio,
        pronouns: [{ value: 'they/them', visibility: 'followers' }],
        gender: 'nonbinary',
        genderVisibility: 'private',
        chosenFamilyLabels: ['chosen sibling'],
        location: 'Legacy plaintext location',
        links: [],
      },
    };

    expect(current.schemaVersion).toBe(2);
    expect(portablePayloadSchema.parse(legacy)).toMatchObject({
      schemaVersion: 1,
      type: 'profile',
    });
    expect(() => currentPortablePayloadSchema.parse(legacy)).toThrow();
    expect(() => signPayload(portablePayloadSchema.parse(legacy), privateKey)).toThrow();

    expect(() =>
      portablePayloadSchema.parse({
        ...legacy,
        schemaVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...current,
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...current,
        schemaVersion: 3,
      }),
    ).toThrow();
  });

  it('rejects self-directed follow and block edges', () => {
    for (const type of ['follow-edge', 'block-edge'] as const) {
      const payload = payloadOf(type);
      expect(() =>
        portablePayloadSchema.parse({
          ...payload,
          content: { ...payload.content, target: author },
        }),
      ).toThrow(/cannot (?:follow|block) itself/u);
    }
  });

  it('normalizes handle syntax and requires a prior claim before release', () => {
    const payload = payloadOf('handle-claim');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, handle: 'River' },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, state: 'released' },
      }),
    ).toThrow(/cannot be released/u);
    for (const valid of ['abc', 'a'.repeat(30)]) {
      expect(
        portablePayloadSchema.safeParse({
          ...payload,
          content: { ...payload.content, handle: valid },
        }).success,
      ).toBe(true);
    }
    for (const invalid of ['ab', 'a'.repeat(31)]) {
      expect(
        portablePayloadSchema.safeParse({
          ...payload,
          content: { ...payload.content, handle: invalid },
        }).success,
      ).toBe(false);
    }
  });

  it('requires delegated keys to belong to the delegating identity', () => {
    const payload = payloadOf('delegation');
    const publicKey = payload.content.delegateKey.split('/').at(-1);
    if (publicKey === undefined) {
      throw new Error('Expected a delegated key.');
    }
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          delegateKey: `${otherIdentity}#delegation/${publicKey}`,
        },
      }),
    ).toThrow(/must belong to the payload author/u);
  });

  it('requires substantive post and reply content with correctly typed references', () => {
    const post = payloadOf('post');
    expect(() =>
      portablePayloadSchema.parse({
        ...post,
        content: { ...post.content, body: undefined },
      }),
    ).toThrow(/requires a body/u);

    const reply = payloadOf('reply');
    expect(() =>
      portablePayloadSchema.parse({
        ...reply,
        content: { ...reply.content, replyTo: objectReference('community') },
      }),
    ).toThrow(/Expected an object reference/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...post,
        content: {
          ...post.content,
          visibility: {
            kind: 'restricted',
            policyId: objectReference('community-rule-set').id,
          },
        },
      }),
    ).toThrow(/must use encrypted references/u);
  });

  it('rejects follower and private profile identity attributes with inline plaintext', () => {
    const profile = payloadOf('profile');
    const rawProtectedAttributes = [
      {
        ...profile.content,
        pronouns: [{ visibility: 'private', value: 'secret pronouns' }],
      },
      {
        ...profile.content,
        gender: { visibility: 'followers', value: 'secret gender' },
      },
      {
        ...profile.content,
        chosenFamilyLabels: [{ visibility: 'private', value: 'secret family label' }],
      },
      {
        ...profile.content,
        location: { visibility: 'followers', value: 'secret location' },
      },
      {
        ...profile.content,
        gender: undefined,
        genderVisibility: 'private',
      },
    ];

    for (const content of rawProtectedAttributes) {
      expect(portablePayloadSchema.safeParse({ ...profile, content }).success).toBe(false);
    }
  });

  it('requires encrypted content references for follower and private profile attributes', () => {
    const profile = payloadOf('profile');
    const publicReference = {
      ...encryptedContentReference,
      protection: { kind: 'public' },
    };
    const referenceWithoutProtection = {
      cid: encryptedContentReference.cid,
      digest: encryptedContentReference.digest,
      bytes: encryptedContentReference.bytes,
      mediaType: encryptedContentReference.mediaType,
    };
    const unencryptedProtectedAttributes = [
      {
        ...profile.content,
        pronouns: [{ visibility: 'followers', valueReference: publicReference }],
      },
      {
        ...profile.content,
        gender: { visibility: 'private', valueReference: referenceWithoutProtection },
      },
      {
        ...profile.content,
        chosenFamilyLabels: [
          { visibility: 'followers', valueReference: referenceWithoutProtection },
        ],
      },
      {
        ...profile.content,
        location: { visibility: 'private', valueReference: publicReference },
      },
    ];

    for (const content of unencryptedProtectedAttributes) {
      expect(portablePayloadSchema.safeParse({ ...profile, content }).success).toBe(false);
    }
  });

  it('rejects duplicate media content identifiers', () => {
    const payload = payloadOf('media-manifest');
    const variant = payload.content.variants[0];
    if (variant === undefined) {
      throw new Error('Expected a media variant.');
    }
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          variants: [
            {
              ...variant,
              reference: { ...variant.reference, cid: payload.content.original.cid },
            },
          ],
        },
      }),
    ).toThrow(/distinct content identifiers/u);
  });

  it('does not allow active roles on inactive community memberships', () => {
    const payload = payloadOf('community-membership');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, state: 'left' },
      }),
    ).toThrow(/Only active memberships/u);
  });

  it('bounds community governance, federation, privacy, and treasury configuration', () => {
    const payload = payloadOf('community');
    expect(
      portablePayloadSchema.safeParse({
        ...payload,
        content: { ...payload.content, visibility: 'private' },
      }).success,
    ).toBe(true);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          governanceModel: 'reputation-weighted-with-cap',
        },
      }),
    ).toThrow(/requires an explicit weight cap/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          governanceModel: 'delegated-voting',
        },
      }),
    ).toThrow(/requires a delegation policy/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          governanceModel: 'moderator-council',
        },
      }),
    ).toThrow(/requires a council role/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          governanceModel: 'supermajority',
        },
      }),
    ).toThrow(/requires a bounded supermajority threshold/u);
    expect(
      portablePayloadSchema.safeParse({
        ...payload,
        content: {
          ...payload.content,
          governanceModel: 'supermajority',
          governanceThreshold: { kind: 'supermajority', basisPoints: 6_667 },
        },
      }).success,
    ).toBe(true);

    const blockedPeer = payload.content.federationPolicy.block[0];
    if (blockedPeer === undefined) {
      throw new Error('Expected a federation peer.');
    }
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          federationPolicy: {
            mode: 'allow-list',
            allow: [],
            block: [],
          },
        },
      }),
    ).toThrow(/requires at least one allowed peer/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          federationPolicy: {
            mode: 'allow-list',
            allow: [blockedPeer],
            block: [blockedPeer],
          },
        },
      }),
    ).toThrow(/both allowed and blocked/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          treasury: {
            account: '1',
            policy: objectReference('community-rule-set'),
            assetAllowList: [],
          },
        },
      }),
    ).toThrow(/decode to exactly 32 bytes/u);
  });

  it('requires exact rule-set version structure and unique rule IDs', () => {
    const payload = payloadOf('community-rule-set');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, version: 2 },
      }),
    ).toThrow(/must reference the previous version/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          rules: [payload.content.rules[0], payload.content.rules[0]],
        },
      }),
    ).toThrow(/rule IDs must be unique/u);
  });

  it('requires confidence metadata for automated moderation labels', () => {
    const payload = payloadOf('moderation-label');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, source: 'automated' },
      }),
    ).toThrow(/confidence statement/u);
  });

  it('requires moderation evidence to be encrypted and bounded', () => {
    const payload = payloadOf('report');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          evidence: [
            {
              ...encryptedContentReference,
              protection: { kind: 'public' },
            },
          ],
        },
      }),
    ).toThrow(/must reference encrypted content/u);
  });

  it('requires positive payment amounts and exact recipient splits', () => {
    const payload = payloadOf('creator-offering');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          price: { ...payload.content.price, amount: '0' },
        },
      }),
    ).toThrow(/must be positive/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          recipientSplits: [{ recipient: author, basisPoints: 9_999 }],
        },
      }),
    ).toThrow(/10,000 basis points/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: {
          ...payload.content,
          price: { asset: { kind: 'sol' }, amount: '1' },
        },
      }),
    ).toThrow();
  });

  it('requires event authorship, chronological times, and cancellation reasons', () => {
    const payload = payloadOf('event');
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, hosts: [otherIdentity] },
      }),
    ).toThrow(/author must be one of its hosts/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, endsAt: payload.content.startsAt },
      }),
    ).toThrow(/must end after/u);
    expect(() =>
      portablePayloadSchema.parse({
        ...payload,
        content: { ...payload.content, state: 'cancelled' },
      }),
    ).toThrow(/require a reason/u);
  });

  it('rejects duplicate notification categories and cross-type replacement references', () => {
    const preferences = payloadOf('notification-preference');
    const rule = preferences.content.rules[0];
    if (rule === undefined) {
      throw new Error('Expected a notification rule.');
    }
    expect(() =>
      portablePayloadSchema.parse({
        ...preferences,
        content: { ...preferences.content, rules: [rule, rule] },
      }),
    ).toThrow(/categories must be unique/u);

    const follow = payloadOf('follow-edge');
    expect(() =>
      portablePayloadSchema.parse({
        ...follow,
        content: {
          ...follow.content,
          replacement: {
            sequence: 2,
            replaces: objectReference('post'),
          },
        },
      }),
    ).toThrow(/must reference the same object type/u);
  });
});

describe('WokeNet and integer representation bounds', () => {
  it('requires all network, identity, and signing-key segments to decode to 32 bytes', () => {
    const [, , genesis, program] = network.split(':');
    const identityAddress = author.split(':').at(-1);
    if (genesis === undefined || program === undefined || identityAddress === undefined) {
      throw new Error('Expected network key segments.');
    }

    expect(networkIdSchema.safeParse(network).success).toBe(true);
    expect(
      networkIdSchema.safeParse(`wokenet:v1:${bs58.encode(new Uint8Array(31))}:${program}`).success,
    ).toBe(false);
    expect(
      networkIdSchema.safeParse(`wokenet:v1:${genesis}:${bs58.encode(new Uint8Array(33))}`).success,
    ).toBe(false);
    expect(
      identityIdSchema.safeParse(`${author.slice(0, author.lastIndexOf(':') + 1)}1`).success,
    ).toBe(false);
    expect(signingKeyIdSchema.safeParse(`${author}#delegation/1`).success).toBe(false);

    const legacyNetwork = `solana:${genesis}:${program}`;
    const legacyIdentity = `wokesocialid:v1:${legacyNetwork}:${identityAddress}`;
    expect(networkIdSchema.safeParse(legacyNetwork).success).toBe(false);
    expect(identityIdSchema.safeParse(legacyIdentity).success).toBe(false);
    expect(signingKeyIdSchema.safeParse(`${legacyIdentity}#root/${program}`).success).toBe(false);
    expect(networkIdSchema.safeParse(`othernet:v2:${genesis}:${program}`).success).toBe(false);
    expect(
      identityIdSchema.safeParse(
        `wokesocialid:v1:othernet:v2:${genesis}:${program}:${identityAddress}`,
      ).success,
    ).toBe(false);
  });

  it('requires transaction signatures to decode to exactly 64 bytes', () => {
    expect(transactionSignatureSchema.safeParse(bs58.encode(new Uint8Array(64))).success).toBe(
      true,
    );
    expect(transactionSignatureSchema.safeParse(bs58.encode(new Uint8Array(63))).success).toBe(
      false,
    );
    expect(transactionSignatureSchema.safeParse(bs58.encode(new Uint8Array(65))).success).toBe(
      false,
    );
  });

  it('bounds decimal strings to unsigned protocol integer widths', () => {
    expect(tokenAmountSchema.safeParse('340282366920938463463374607431768211455').success).toBe(
      true,
    );
    expect(tokenAmountSchema.safeParse('340282366920938463463374607431768211456').success).toBe(
      false,
    );
    expect(unsigned64Schema.safeParse('18446744073709551615').success).toBe(true);
    expect(unsigned64Schema.safeParse('18446744073709551616').success).toBe(false);
  });
});
