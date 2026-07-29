import { randomBytes } from 'node:crypto';

import bs58 from 'bs58';

import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  encodeMultibaseBase64Url,
  type CommunityMembershipContent,
  type NetworkId,
} from '@wokesocial/protocol';

import {
  deriveCommunityMembershipAddress,
  GOVERNANCE_STRATEGY_HASH,
  type ProjectionReplayItem,
  type ProjectionStore,
  type VerifiedManifest,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

export async function exerciseModerationAfterMemberDeactivation(
  projection: ProjectionStore,
  signingKind: 'root' | 'delegation',
) {
  const programId = publicKey();
  const networkId = `wokenet:v1:${publicKey()}:${programId}` as NetworkId;
  const configAddress = publicKey();
  const creatorAddress = publicKey();
  const memberAddress = publicKey();
  const rootAuthority = publicKey();
  const memberAuthority = publicKey();
  const delegateAuthority = publicKey();
  const creatorIdentityId = `wokesocialid:v1:${networkId}:${creatorAddress}`;
  const memberIdentityId = `wokesocialid:v1:${networkId}:${memberAddress}`;
  const communityAddress = publicKey();
  const membershipAddress = await deriveCommunityMembershipAddress(
    programId,
    communityAddress,
    memberAddress,
  );
  const communityHash = digest();
  const joinHash = digest();
  const moderationHash = digest();
  const joinObjectId = `wokesocialobj:v1:community-membership:${joinHash}`;
  const action = signingKind === 'root' ? 'remove' : 'ban';
  const state = signingKind === 'root' ? 'removed' : 'banned';
  const actorSequence = signingKind === 'root' ? 2n : 3n;
  const moderationAuthority = signingKind === 'root' ? rootAuthority : delegateAuthority;
  const moderationContent: CommunityMembershipContent =
    signingKind === 'root'
      ? {
          communityAddress,
          member: memberIdentityId,
          action: 'remove',
          state: 'removed',
          roles: [],
          reason: 'Identity deactivated.',
          replacement: {
            sequence: 2,
            replaces: { id: joinObjectId },
          },
        }
      : {
          communityAddress,
          member: memberIdentityId,
          action: 'ban',
          state: 'banned',
          roles: [],
          reason: 'Identity deactivated.',
          replacement: {
            sequence: 2,
            replaces: { id: joinObjectId },
          },
        };

  const communityManifest: VerifiedManifest = {
    objectId: `wokesocialobj:v1:community:${communityHash}`,
    cid: TEST_CID,
    payloadHash: communityHash,
    schemaVersion: 2,
    signingKeyId: `${creatorIdentityId}#root/${rootAuthority}`,
    authorIdentityId: creatorIdentityId,
    createdAt: '2026-07-29T12:00:04.000Z',
    type: 'community',
    content: {
      slug: `inactive-member-${signingKind}`,
      name: `Inactive member ${signingKind}`,
      description: 'Projection parity fixture.',
      visibility: 'public',
      membershipPolicy: 'open',
      governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
      federationPolicy: { mode: 'open', allow: [], block: [] },
      replacement: { sequence: 1 },
    },
  };
  const joinManifest: VerifiedManifest = {
    objectId: joinObjectId,
    cid: TEST_CID,
    payloadHash: joinHash,
    schemaVersion: 2,
    signingKeyId: `${memberIdentityId}#root/${memberAuthority}`,
    authorIdentityId: memberIdentityId,
    createdAt: '2026-07-29T12:00:05.000Z',
    type: 'community-membership',
    content: {
      communityAddress,
      member: memberIdentityId,
      action: 'join',
      state: 'active',
      roles: ['member'],
      replacement: { sequence: 1 },
    } satisfies CommunityMembershipContent,
  };
  const moderationManifest: VerifiedManifest = {
    objectId: `wokesocialobj:v1:community-membership:${moderationHash}`,
    cid: TEST_CID,
    payloadHash: moderationHash,
    schemaVersion: 2,
    signingKeyId: `${creatorIdentityId}#${signingKind}/${moderationAuthority}`,
    authorIdentityId: creatorIdentityId,
    createdAt: '2026-07-29T12:00:08.000Z',
    type: 'community-membership',
    content: moderationContent,
  };
  let transactionIndex = 0;
  const base = (slot: bigint) => ({
    networkId,
    programId,
    transactionSignature: signature(),
    transactionIndex: transactionIndex++,
    slot,
    logIndex: 0,
    blockTime: `2026-07-29T12:00:${slot.toString().padStart(2, '0')}.000Z`,
    finalized: true as const,
  });
  const items: ProjectionReplayItem[] = [
    {
      event: {
        ...base(1n),
        type: 'protocol-initialized',
        configAddress,
      },
    },
    {
      event: {
        ...base(2n),
        type: 'identity-created',
        identityId: creatorIdentityId,
        identityAddress: creatorAddress,
        rootAuthority,
      },
    },
    {
      event: {
        ...base(3n),
        type: 'identity-created',
        identityId: memberIdentityId,
        identityAddress: memberAddress,
        rootAuthority: memberAuthority,
      },
    },
    {
      event: {
        ...base(4n),
        type: 'community-created',
        communityAddress,
        creatorIdentityId,
        authority: rootAuthority,
        creatorSequence: 1n,
        manifestCid: TEST_CID,
        manifestHash: communityHash,
        governanceVersion: 1,
        governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
        visibility: 'public',
        membershipPolicy: 'open',
        membershipPolicySequence: 1n,
        membershipSequence: 0n,
      },
      manifest: communityManifest,
    },
    {
      event: {
        ...base(5n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress,
        memberIdentityId,
        actorIdentityId: memberIdentityId,
        authority: memberAuthority,
        action: 'join',
        state: 'active',
        actorSequence: 1n,
        memberActionSequence: 1n,
        membershipPolicySequence: 1n,
        communityMembershipSequence: 1n,
        activeSinceMembershipSequence: 1n,
        membershipStateSequence: 1n,
        roles: 1,
        manifestCid: TEST_CID,
        manifestHash: joinHash,
        manifestUri: `ipfs://${TEST_CID}`,
      },
      manifest: joinManifest,
    },
    ...(signingKind === 'delegation'
      ? [
          {
            event: {
              ...base(6n),
              type: 'delegation-created' as const,
              identityId: creatorIdentityId,
              delegationAddress: publicKey(),
              delegateAuthority,
              delegationSequence: 1n,
              identitySequence: 2n,
              scopes: 1 << 3,
              issuedAtRootRotationCount: 0n,
              expiresAtSlot: 100n,
            },
          },
        ]
      : []),
    {
      event: {
        ...base(7n),
        type: 'identity-deactivated',
        configAddress,
        identityId: memberIdentityId,
        identityAddress: memberAddress,
        rootAuthority: memberAuthority,
        identitySequence: 2n,
      },
    },
    {
      event: {
        ...base(8n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress,
        memberIdentityId,
        actorIdentityId: creatorIdentityId,
        authority: moderationAuthority,
        action,
        state,
        actorSequence,
        memberActionSequence: 1n,
        membershipPolicySequence: 1n,
        communityMembershipSequence: 2n,
        activeSinceMembershipSequence: 0n,
        membershipStateSequence: 2n,
        roles: 0,
        manifestCid: TEST_CID,
        manifestHash: moderationHash,
        manifestUri: `ipfs://${TEST_CID}`,
      },
      manifest: moderationManifest,
    },
  ];

  for (const item of items) {
    await projection.apply(item.event, item.manifest);
  }
  const beforeReplay = await projection.getCommunityMemberships(networkId, communityAddress);
  await projection.rebuildProjection(networkId, [...items].reverse());
  const afterReplay = await projection.getCommunityMemberships(networkId, communityAddress);

  return {
    networkId,
    membershipAddress,
    state,
    beforeReplay,
    afterReplay,
  };
}

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}

function signature(): string {
  return bs58.encode(randomBytes(64));
}

function digest(): string {
  return encodeMultibaseBase64Url(randomBytes(32));
}
