import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  assertValidCommunityMembershipTransition,
  assertValidObjectTransition,
  assertValidReplacementTransition,
  authorizationRequirementFor,
  buildCommunityMembershipPayload,
  canonicalizeEnvelope,
  canonicalizePayload,
  canonicalizeProofDescriptor,
  createPayloadBuilderIdentity,
  currentPortablePayloadSchema,
  digestSha256Multibase,
  encodeMultibaseBase64Url,
  getObjectId,
  portablePayloadSchema,
  SIGNATURE_DOMAIN,
  signPayload,
  verifyEnvelope,
  type SignedEnvelope,
} from '../src/index.js';
import { author, identity, network, privateKey } from './fixtures.js';
import { communityAddress, fixedNonce, objectReference, otherIdentity } from './object-fixtures.js';

const moderatorPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 180 - index);
const moderatorPublicKey = ed25519.getPublicKey(moderatorPrivateKey);
const moderatorIdentity = createPayloadBuilderIdentity(network, otherIdentity, moderatorPublicKey);
const otherCommunityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 12));

const optionsAt = (createdAt: string) => ({
  createdAt: new Date(createdAt),
  nonce: fixedNonce,
});

const buildJoin = (createdAt = '2026-07-28T12:00:00.000Z') =>
  buildCommunityMembershipPayload(
    identity,
    {
      communityAddress,
      member: author,
      action: 'join',
      state: 'active',
      roles: ['member'],
      replacement: { sequence: 1 },
    },
    optionsAt(createdAt),
  );

describe('community membership v2', () => {
  it('keeps legacy authority-assigned membership objects readable but not creatable', async () => {
    const current = buildJoin();
    const legacy = {
      ...current,
      schemaVersion: 1,
      content: {
        community: objectReference('community'),
        member: otherIdentity,
        state: 'active',
        roles: [{ role: 'member', state: 'active' }],
        replacement: { sequence: 1 },
      },
    };

    expect(current.schemaVersion).toBe(2);
    const legacyPayload = portablePayloadSchema.parse(legacy);
    expect(legacyPayload).toMatchObject({
      schemaVersion: 1,
      type: 'community-membership',
    });
    expect(() => currentPortablePayloadSchema.parse(legacy)).toThrow();
    expect(() => signPayload(legacyPayload, privateKey)).toThrow();
    expect(authorizationRequirementFor(legacyPayload).externalChecks).toContain(
      'community-authority',
    );
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

    const payloadHash = digestSha256Multibase(canonicalizePayload(legacyPayload));
    const signature = ed25519.sign(
      canonicalizeProofDescriptor({
        domain: SIGNATURE_DOMAIN,
        version: 1,
        algorithm: 'Ed25519',
        keyId: legacyPayload.signingKey,
        network: legacyPayload.network,
        objectType: legacyPayload.type,
        payloadHash,
      }),
      privateKey,
    );
    await expect(
      verifyEnvelope({
        payload: legacyPayload,
        proof: {
          algorithm: 'Ed25519',
          keyId: legacyPayload.signingKey,
          payloadHash,
          signature: encodeMultibaseBase64Url(signature),
        },
      }),
    ).resolves.toMatchObject({
      envelope: { payload: { schemaVersion: 1, type: 'community-membership' } },
    });
  });

  it('binds self actions to the member and moderation actions to another author', () => {
    expect(buildJoin()).toMatchObject({
      author,
      content: {
        communityAddress,
        member: author,
        action: 'join',
        state: 'active',
        roles: ['member'],
      },
    });

    expect(() =>
      buildCommunityMembershipPayload(
        identity,
        {
          communityAddress,
          member: otherIdentity,
          action: 'join',
          state: 'active',
          roles: ['member'],
          replacement: { sequence: 1 },
        },
        optionsAt('2026-07-28T12:00:00.000Z'),
      ),
    ).toThrow(/authored by the member/u);

    const removal = buildCommunityMembershipPayload(
      moderatorIdentity,
      {
        communityAddress,
        member: author,
        action: 'remove',
        state: 'removed',
        roles: [],
        reason: 'Repeated violations of the published community rules.',
        replacement: {
          sequence: 2,
          replaces: objectReference('community-membership'),
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    expect(removal.author).toBe(otherIdentity);
    expect(authorizationRequirementFor(removal)).toMatchObject({
      scopes: ['community.admin'],
      externalChecks: expect.arrayContaining(['community-authority', 'community-membership']),
    });

    expect(() =>
      buildCommunityMembershipPayload(
        identity,
        {
          communityAddress,
          member: author,
          action: 'ban',
          state: 'banned',
          roles: [],
          reason: 'A member cannot ban themself.',
          replacement: {
            sequence: 2,
            replaces: objectReference('community-membership'),
          },
        },
        optionsAt('2026-07-28T12:00:01.000Z'),
      ),
    ).toThrow(/authored by a moderator/u);

    expect(authorizationRequirementFor(buildJoin())).toMatchObject({
      scopes: ['community.membership'],
      externalChecks: expect.arrayContaining([
        'community-membership-policy',
        'community-membership',
      ]),
    });
    expect(authorizationRequirementFor(buildJoin()).externalChecks).not.toContain(
      'community-authority',
    );

    const leave = buildCommunityMembershipPayload(
      identity,
      {
        communityAddress,
        member: author,
        action: 'leave',
        state: 'left',
        roles: [],
        replacement: {
          sequence: 2,
          replaces: objectReference('community-membership'),
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    expect(authorizationRequirementFor(leave).externalChecks).not.toContain(
      'community-membership-policy',
    );
  });

  it('encodes exact action, state, role, reason, and initial-sequence semantics', () => {
    const join = buildJoin();
    expect(() =>
      portablePayloadSchema.parse({
        ...join,
        content: { ...join.content, state: 'left' },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...join,
        content: { ...join.content, roles: [] },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...join,
        content: { ...join.content, roles: ['member', 'moderator'] },
      }),
    ).toThrow();
    expect(() =>
      portablePayloadSchema.parse({
        ...join,
        content: { ...join.content, reason: 'Not valid on a self join.' },
      }),
    ).toThrow();

    expect(() =>
      buildCommunityMembershipPayload(
        identity,
        {
          communityAddress,
          member: author,
          action: 'leave',
          state: 'left',
          roles: [],
          replacement: { sequence: 1 },
        },
        optionsAt('2026-07-28T12:00:01.000Z'),
      ),
    ).toThrow(/first community membership action/u);

    expect(() =>
      buildCommunityMembershipPayload(
        moderatorIdentity,
        {
          communityAddress,
          member: author,
          action: 'remove',
          state: 'removed',
          roles: [],
          reason: ' ',
          replacement: {
            sequence: 2,
            replaces: objectReference('community-membership'),
          },
        },
        optionsAt('2026-07-28T12:00:01.000Z'),
      ),
    ).toThrow(/cannot be blank/u);
  });

  it('requires the community address and member identity to match the payload network', () => {
    const join = buildJoin();
    expect(() =>
      portablePayloadSchema.parse({
        ...join,
        content: {
          ...join.content,
          communityAddress: objectReference('community').id,
        },
      }),
    ).toThrow();

    const alternateGenesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 13));
    const alternateIdentityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 14));
    const [, , , programAddress] = network.split(':');
    const alternateMember = `wetdroolid:v1:droolnet:v1:${alternateGenesis}:${programAddress}:${alternateIdentityAddress}`;
    const result = currentPortablePayloadSchema.safeParse({
      ...buildCommunityMembershipPayload(
        moderatorIdentity,
        {
          communityAddress,
          member: author,
          action: 'remove',
          state: 'removed',
          roles: [],
          reason: 'Network isolation test.',
          replacement: {
            sequence: 2,
            replaces: objectReference('community-membership'),
          },
        },
        optionsAt('2026-07-28T12:00:01.000Z'),
      ),
      content: {
        communityAddress,
        member: alternateMember,
        action: 'remove',
        state: 'removed',
        roles: [],
        reason: 'Network isolation test.',
        replacement: {
          sequence: 2,
          replaces: objectReference('community-membership'),
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'The community member must belong to the payload network.',
      );
    }
  });

  it('accepts only exact monotonic replacement transitions across member and moderator actors', () => {
    const join = buildJoin();
    const leave = buildCommunityMembershipPayload(
      identity,
      {
        communityAddress,
        member: author,
        action: 'leave',
        state: 'left',
        roles: [],
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(join) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const rejoin = buildCommunityMembershipPayload(
      identity,
      {
        communityAddress,
        member: author,
        action: 'join',
        state: 'active',
        roles: ['member'],
        replacement: {
          sequence: 3,
          replaces: { id: getObjectId(leave) },
        },
      },
      optionsAt('2026-07-28T12:00:02.000Z'),
    );
    const removal = buildCommunityMembershipPayload(
      moderatorIdentity,
      {
        communityAddress,
        member: author,
        action: 'remove',
        state: 'removed',
        roles: [],
        reason: 'Moderator action with an independently authorized actor.',
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(join) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidCommunityMembershipTransition(join, leave)).not.toThrow();
    expect(() => assertValidReplacementTransition(join, leave)).not.toThrow();
    expect(() => assertValidObjectTransition(join, leave)).not.toThrow();
    expect(() => assertValidCommunityMembershipTransition(leave, rejoin)).not.toThrow();
    expect(() => assertValidCommunityMembershipTransition(join, removal)).not.toThrow();

    const wrongSequence = buildCommunityMembershipPayload(
      identity,
      {
        ...leave.content,
        replacement: {
          sequence: 3,
          replaces: { id: getObjectId(join) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const wrongPrior = buildCommunityMembershipPayload(
      identity,
      {
        ...leave.content,
        replacement: {
          sequence: 2,
          replaces: objectReference('community-membership'),
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const changedCommunity = buildCommunityMembershipPayload(
      identity,
      {
        ...leave.content,
        communityAddress: otherCommunityAddress,
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const changedMember = buildCommunityMembershipPayload(
      moderatorIdentity,
      {
        ...leave.content,
        member: otherIdentity,
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const unchangedTimestamp = buildCommunityMembershipPayload(
      identity,
      leave.content,
      optionsAt('2026-07-28T12:00:00.000Z'),
    );

    expect(() => assertValidCommunityMembershipTransition(join, wrongSequence)).toThrow(
      /sequences must increase by exactly one/u,
    );
    expect(() => assertValidCommunityMembershipTransition(join, wrongPrior)).toThrow(
      /exact prior object ID/u,
    );
    expect(() => assertValidCommunityMembershipTransition(join, changedCommunity)).toThrow(
      /cannot change communities/u,
    );
    expect(() => assertValidCommunityMembershipTransition(join, changedMember)).toThrow(
      /cannot change members/u,
    );
    expect(() => assertValidCommunityMembershipTransition(join, unchangedTimestamp)).toThrow(
      /timestamps must increase/u,
    );
  });

  it('enforces the fail-closed membership state transition table', () => {
    const join = buildJoin();
    const duplicateJoin = buildCommunityMembershipPayload(
      identity,
      {
        ...join.content,
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(join) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    expect(() => assertValidCommunityMembershipTransition(join, duplicateJoin)).toThrow(
      /action join cannot follow state active/u,
    );

    const ban = buildCommunityMembershipPayload(
      moderatorIdentity,
      {
        communityAddress,
        member: author,
        action: 'ban',
        state: 'banned',
        roles: [],
        reason: 'Terminal ban for the transition-table test.',
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(join) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const joinAfterBan = buildCommunityMembershipPayload(
      identity,
      {
        communityAddress,
        member: author,
        action: 'join',
        state: 'active',
        roles: ['member'],
        replacement: {
          sequence: 3,
          replaces: { id: getObjectId(ban) },
        },
      },
      optionsAt('2026-07-28T12:00:02.000Z'),
    );
    expect(() => assertValidCommunityMembershipTransition(join, ban)).not.toThrow();
    expect(() => assertValidCommunityMembershipTransition(ban, joinAfterBan)).toThrow(
      /action join cannot follow state banned/u,
    );
  });

  it('canonically signs every bound field and rejects post-signature mutation', async () => {
    const join = buildJoin();
    const envelope = signPayload(join, privateKey);

    await expect(verifyEnvelope(canonicalizeEnvelope(envelope))).resolves.toMatchObject({
      envelope: {
        payload: {
          schemaVersion: 2,
          type: 'community-membership',
          content: { communityAddress, member: author, action: 'join' },
        },
      },
    });

    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        content: {
          ...envelope.payload.content,
          communityAddress: otherCommunityAddress,
        },
      },
    } as SignedEnvelope;
    await expect(verifyEnvelope(tampered)).rejects.toThrow('Payload hash does not match proof.');
  });
});
