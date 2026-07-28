import { createHash } from 'node:crypto';

import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { encodeMultibaseBase64Url } from '@socially-woke/protocol';

import { GOVERNANCE_STRATEGY_HASH, protocolEventSchema } from '../src/index.js';

const programId = publicKey(1);
const otherProgramId = publicKey(2);
const networkId = `woke:v1:${publicKey(3)}:${programId}`;
const secondNetworkId = `woke:v1:${publicKey(4)}:${programId}`;
const otherProgramNetworkId = `woke:v1:${publicKey(5)}:${otherProgramId}`;
const identityAddress = publicKey(6);
const secondIdentityAddress = publicKey(7);
const thirdIdentityAddress = publicKey(8);
const identityId = identity(identityAddress);
const secondIdentityId = identity(secondIdentityAddress);
const thirdIdentityId = identity(thirdIdentityAddress);

const publicKeyFields = new Set([
  'programId',
  'configAddress',
  'identityAddress',
  'rootAuthority',
  'authority',
  'previousRootAuthority',
  'newRootAuthority',
  'handleClaimAddress',
  'delegationAddress',
  'delegateAuthority',
  'postReference',
  'targetPostReference',
  'blockEdgeAddress',
  'communityAddress',
  'membershipAddress',
  'reactionReference',
  'recoveryPolicyAddress',
  'recoveryRequestAddress',
  'requestingGuardian',
  'currentRootAuthority',
  'targetRootAuthority',
  'guardian',
  'cancelledByRootAuthority',
  'executor',
  'proposalAddress',
  'voteAddress',
  'finalizer',
  'paymentConfigAddress',
  'upgradeAuthority',
  'paymentAuthority',
  'feeDestination',
  'previousFeeDestination',
  'previousAuthority',
  'newAuthority',
  'offeringAddress',
  'recipientDestination',
  'receiptAddress',
  'entitlementAddress',
]);

const fixtures = [
  fixture('protocol', {
    ...base(10),
    type: 'protocol-initialized',
    configAddress: publicKey(10),
  }),
  fixture('identity', {
    ...base(11),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority: publicKey(11),
  }),
  fixture('handle', {
    ...base(12),
    type: 'handle-claimed',
    handleClaimAddress: publicKey(12),
    identityId,
    authority: publicKey(13),
    identitySequence: 1n,
    handleHash: encodeMultibaseBase64Url(createHash('sha256').update('river_chen').digest()),
    handle: 'river_chen',
  }),
  fixture('handle-release', {
    ...base(122),
    type: 'handle-released',
    handleClaimAddress: publicKey(12),
    identityId,
    authority: publicKey(13),
    identitySequence: 2n,
    handleHash: encodeMultibaseBase64Url(createHash('sha256').update('river_chen').digest()),
    handle: 'river_chen',
  }),
  fixture('root-authority-rotation', {
    ...base(123),
    type: 'root-authority-rotated',
    identityId,
    previousRootAuthority: publicKey(11),
    newRootAuthority: publicKey(44),
    identitySequence: 2n,
    rotationCount: 1n,
  }),
  fixture('delegation', {
    ...base(13),
    type: 'delegation-created',
    identityId,
    delegationAddress: publicKey(14),
    delegateAuthority: publicKey(15),
    delegationSequence: 1n,
    identitySequence: 2n,
    scopes: 1,
    issuedAtRootRotationCount: 0n,
    expiresAtSlot: 100n,
  }),
  fixture('delegation-revocation', {
    ...base(131),
    type: 'delegation-revoked',
    identityId,
    delegationAddress: publicKey(14),
    delegateAuthority: publicKey(15),
    delegationSequence: 1n,
    identitySequence: 3n,
    delegationStateSequence: 2n,
  }),
  fixture('profile-content', {
    ...base(132),
    type: 'profile-updated',
    identityId,
    authority: publicKey(16),
    objectId: `swobj:v1:profile:${digest(45)}`,
    cid: `b${'d'.repeat(20)}`,
    payloadHash: digest(46),
    sequence: 3n,
  }),
  fixture('portable-content', {
    ...base(14),
    type: 'post-published',
    identityId,
    authority: publicKey(16),
    postReference: publicKey(17),
    objectId: `swobj:v1:post:${digest(18)}`,
    cid: `b${'a'.repeat(20)}`,
    payloadHash: digest(19),
    sequence: 3n,
  }),
  fixture('tombstone', {
    ...base(141),
    type: 'tombstoned',
    identityId,
    targetPostReference: publicKey(17),
    targetObjectId: `swobj:v1:post:${digest(18)}`,
    sequence: 4n,
  }),
  fixture('social-edges', {
    ...base(15),
    type: 'block-changed',
    blockEdgeAddress: publicKey(20),
    blockerIdentityId: identityId,
    subjectIdentityId: secondIdentityId,
    authority: publicKey(21),
    blockerSequence: 4n,
    edgeStateSequence: 1n,
    active: true,
  }),
  fixture('follow', {
    ...base(151),
    type: 'follow-changed',
    followerIdentityId: identityId,
    followedIdentityId: secondIdentityId,
    active: true,
    sequence: 1n,
  }),
  fixture('community', {
    ...base(152),
    type: 'community-created',
    communityAddress: publicKey(41),
    creatorIdentityId: identityId,
    authority: publicKey(42),
    creatorSequence: 1n,
    manifestCid: `b${'c'.repeat(20)}`,
    manifestHash: digest(43),
    governanceVersion: 1,
    governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
  }),
  fixture('community-governance', {
    ...base(153),
    type: 'community-governance-updated',
    communityAddress: publicKey(41),
    creatorIdentityId: identityId,
    authority: publicKey(42),
    creatorSequence: 2n,
    previousGovernanceVersion: 1,
    governanceVersion: 2,
    previousStrategyHash: GOVERNANCE_STRATEGY_HASH,
    governanceStrategyHash: digest(47),
  }),
  fixture('community-membership', {
    ...base(16),
    type: 'community-membership-changed',
    communityAddress: publicKey(22),
    membershipAddress: publicKey(23),
    memberIdentityId: secondIdentityId,
    assignedByIdentityId: identityId,
    authority: publicKey(24),
    authoritySequence: 5n,
    membershipStateSequence: 1n,
    roles: 1,
    active: true,
  }),
  fixture('reaction', {
    ...base(17),
    type: 'reaction-changed',
    reactionReference: publicKey(25),
    reactorIdentityId: thirdIdentityId,
    targetPostReference: publicKey(26),
    authority: publicKey(27),
    reactionKind: 1,
    reactorSequence: 1n,
    reactionStateSequence: 1n,
    active: true,
  }),
  fixture('recovery-policy', {
    ...base(18),
    type: 'recovery-policy-configured',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    rootAuthority: publicKey(29),
    policySequence: 1n,
    identitySequence: 6n,
    rootRotationCount: 0n,
    guardians: [publicKey(30), publicKey(31)],
    threshold: 2,
    delaySlots: 2n,
  }),
  fixture('recovery-policy-disable', {
    ...base(181),
    type: 'recovery-policy-disabled',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    rootAuthority: publicKey(29),
    policySequence: 2n,
    identitySequence: 7n,
    rootRotationCount: 0n,
  }),
  fixture('recovery-request', {
    ...base(19),
    type: 'recovery-requested',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    recoveryRequestAddress: publicKey(32),
    requestingGuardian: publicKey(30),
    requestNonce: '00112233445566778899aabbccddeeff',
    policySequence: 1n,
    currentRootAuthority: publicKey(29),
    identitySequence: 6n,
    rootRotationCount: 0n,
    targetRootAuthority: publicKey(33),
    threshold: 2,
    guardianCount: 2,
    approvalCount: 1,
    executeAfterSlot: 12n,
  }),
  fixture('recovery-approval', {
    ...base(191),
    type: 'recovery-approved',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    recoveryRequestAddress: publicKey(32),
    guardian: publicKey(31),
    guardianIndex: 1,
    policySequence: 1n,
    approvalCount: 2,
    threshold: 2,
  }),
  fixture('recovery-cancellation', {
    ...base(192),
    type: 'recovery-cancelled',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    recoveryRequestAddress: publicKey(32),
    cancelledByRootAuthority: publicKey(29),
    targetRootAuthority: publicKey(33),
    policySequence: 1n,
    identitySequence: 7n,
    rootRotationCount: 0n,
  }),
  fixture('recovery-execution', {
    ...base(193),
    type: 'recovery-executed',
    identityId,
    recoveryPolicyAddress: publicKey(28),
    recoveryRequestAddress: publicKey(32),
    executor: publicKey(30),
    previousRootAuthority: publicKey(29),
    newRootAuthority: publicKey(33),
    policySequence: 1n,
    approvalCount: 2,
    threshold: 2,
    identitySequence: 7n,
    rotationCount: 1n,
  }),
  fixture('governance-proposal', {
    ...base(20),
    type: 'proposal-created',
    communityAddress: publicKey(34),
    proposalAddress: publicKey(35),
    proposerIdentityId: identityId,
    authority: publicKey(36),
    proposerSequence: 2n,
    previousCommunitySequence: 1n,
    manifestHash: digest(37),
    manifestUri: 'local://proposal',
    governanceVersion: 1,
    governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
    votingModel: 'one-active-member-one-vote',
    eligibleMemberCount: 1n,
    opensAtSlot: 10n,
    closesAtSlot: 12n,
    quorumBps: 5000,
    approvalBps: 5001,
    proposalStateSequence: 1n,
  }),
  fixture('governance-vote', {
    ...base(21),
    type: 'vote-cast',
    communityAddress: publicKey(34),
    proposalAddress: publicKey(35),
    voteAddress: publicKey(38),
    voterIdentityId: secondIdentityId,
    membershipAddress: publicKey(39),
    authority: publicKey(40),
    voterSequence: 1n,
    membershipStateSequence: 1n,
    proposalStateSequence: 2n,
    choice: 'yes',
    yesVotes: 1n,
    noVotes: 0n,
    abstainVotes: 0n,
  }),
  fixture('governance-finalization', {
    ...base(211),
    type: 'proposal-finalized',
    communityAddress: publicKey(34),
    proposalAddress: publicKey(35),
    finalizer: publicKey(40),
    proposalStateSequence: 3n,
    eligibleMemberCount: 1n,
    yesVotes: 1n,
    noVotes: 0n,
    abstainVotes: 0n,
    participatingVotes: 1n,
    decisiveVotes: 1n,
    quorumBps: 5000,
    approvalBps: 5001,
    quorumMet: true,
    approvalMet: true,
    outcome: 'accepted',
  }),
  fixture('payment-config-initialization', {
    ...base(212),
    type: 'payment-config-initialized',
    paymentConfigAddress: publicKey(64),
    upgradeAuthority: publicKey(65),
    paymentAuthority: publicKey(66),
    feeDestination: publicKey(72),
    feeBps: 100,
    policySequence: 1n,
    enabled: false,
  }),
  fixture('payment-config-update', {
    ...base(213),
    type: 'payment-config-updated',
    paymentConfigAddress: publicKey(64),
    authority: publicKey(66),
    previousFeeDestination: publicKey(72),
    feeDestination: publicKey(72),
    previousFeeBps: 100,
    feeBps: 100,
    previousEnabled: false,
    enabled: true,
    policySequence: 2n,
  }),
  fixture('payment-authority-rotation', {
    ...base(214),
    type: 'payment-authority-rotated',
    paymentConfigAddress: publicKey(64),
    previousAuthority: publicKey(66),
    newAuthority: publicKey(67),
    policySequence: 3n,
  }),
  fixture('subscription-offering', {
    ...base(215),
    type: 'subscription-offering-created',
    paymentConfigAddress: publicKey(64),
    offeringAddress: publicKey(68),
    creatorIdentityId: identityId,
    rootAuthority: publicKey(70),
    offeringNonce: '00112233445566778899aabbccddeeff',
    manifestHash: digest(69),
    manifestUri: 'ipfs://offering',
    priceLamports: 102n,
    billingInterval: 'week',
    recipientSplits: [
      {
        recipientIdentityId: identityId,
        destination: publicKey(70),
        basisPoints: 5_000,
      },
      {
        recipientIdentityId: secondIdentityId,
        destination: publicKey(71),
        basisPoints: 5_000,
      },
    ],
    refundPolicyHash: digest(73),
    maxProtocolFeeBps: 100,
    creatorRootRotationCount: 0n,
    creatorSequence: 1n,
    offeringStateSequence: 1n,
  }),
  fixture('subscription-offering-retirement', {
    ...base(216),
    type: 'subscription-offering-retired',
    offeringAddress: publicKey(68),
    creatorIdentityId: identityId,
    rootAuthority: publicKey(70),
    manifestHash: digest(69),
    creatorSequence: 2n,
    offeringStateSequence: 2n,
  }),
  fixture('woke-tip-settlement', {
    ...base(217),
    type: 'woke-tip-settled',
    paymentConfigAddress: publicKey(64),
    receiptAddress: publicKey(74),
    payerIdentityId: thirdIdentityId,
    payerAuthority: publicKey(75),
    recipientIdentityId: identityId,
    recipientDestination: publicKey(70),
    receiptNonce: '102132435465768798a9bacbdcedfe0f',
    paymentKind: 'woke-tip',
    payerRootRotationCount: 0n,
    paymentPolicySequence: 3n,
    grossLamports: 101n,
    feeBps: 100,
    feeDestination: publicKey(72),
    feeLamports: 1n,
    distributableLamports: 100n,
    recipientLamports: 100n,
    paidAtTimestamp: 1_800_000_000n,
  }),
  fixture('subscription-settlement', {
    ...base(218),
    type: 'subscription-settled',
    paymentConfigAddress: publicKey(64),
    offeringAddress: publicKey(68),
    receiptAddress: publicKey(76),
    entitlementAddress: publicKey(77),
    creatorIdentityId: identityId,
    payerIdentityId: thirdIdentityId,
    payerAuthority: publicKey(75),
    receiptNonce: '2031425364758697a8b9cadbecfd0e1f',
    paymentKind: 'weekly-subscription',
    payerRootRotationCount: 0n,
    paymentPolicySequence: 3n,
    offeringStateSequence: 1n,
    offeringManifestHash: digest(69),
    refundPolicyHash: digest(73),
    grossLamports: 102n,
    feeBps: 100,
    feeDestination: publicKey(72),
    feeLamports: 1n,
    distributableLamports: 101n,
    recipientSplits: [
      {
        recipientIdentityId: identityId,
        destination: publicKey(70),
        basisPoints: 5_000,
      },
      {
        recipientIdentityId: secondIdentityId,
        destination: publicKey(71),
        basisPoints: 5_000,
      },
    ],
    recipientAmounts: [51n, 50n],
    entitlementStateSequence: 1n,
    settlementCount: 1n,
    entitlementFromTimestamp: 1_800_000_000n,
    entitlementUntilTimestamp: 1_800_604_800n,
    paidAtTimestamp: 1_800_000_000n,
  }),
] as const;

describe('protocol event network and key bindings', () => {
  it('accepts the valid representative from every event family', () => {
    expect(fixtures).toHaveLength(32);
    for (const { family, event } of fixtures) {
      expect(protocolEventSchema.safeParse(event).success, family).toBe(true);
    }
  });

  it('rejects malformed common network, program, and transaction keys in every family', () => {
    for (const { family, event } of fixtures) {
      for (const malformed of [
        { ...event, networkId: 'woke:v1:abc:def' },
        { ...event, programId: 'abc' },
        { ...event, transactionSignature: 'abc' },
        { ...event, networkId: otherProgramNetworkId },
      ]) {
        expect(protocolEventSchema.safeParse(malformed).success, family).toBe(false);
      }
    }
  });

  it('rejects every representative Solana address when it is not exactly 32 bytes', () => {
    for (const { family, event } of fixtures) {
      for (const field of publicKeyFields) {
        if (field in event) {
          expect(
            protocolEventSchema.safeParse({ ...event, [field]: 'abc' }).success,
            `${family}.${field}`,
          ).toBe(false);
        }
      }
      if ('guardians' in event) {
        expect(
          protocolEventSchema.safeParse({ ...event, guardians: ['abc', publicKey(31)] }).success,
          `${family}.guardians`,
        ).toBe(false);
      }
      if ('recipientSplits' in event && Array.isArray(event.recipientSplits)) {
        const [first, ...rest] = event.recipientSplits;
        if (typeof first === 'object' && first !== null) {
          expect(
            protocolEventSchema.safeParse({
              ...event,
              recipientSplits: [{ ...first, destination: 'abc' }, ...rest],
            }).success,
            `${family}.recipientSplits.destination`,
          ).toBe(false);
        }
      }
    }
  });

  it('rejects every identity field when it embeds a different genesis hash', () => {
    for (const { family, event } of fixtures) {
      for (const [field, value] of Object.entries(event)) {
        if (typeof value === 'string' && (field === 'identityId' || field.endsWith('IdentityId'))) {
          expect(
            protocolEventSchema.safeParse({
              ...event,
              [field]: value.replace(networkId, secondNetworkId),
            }).success,
            `${family}.${field}`,
          ).toBe(false);
        }
      }
      if ('recipientSplits' in event && Array.isArray(event.recipientSplits)) {
        const [first, ...rest] = event.recipientSplits;
        if (
          typeof first === 'object' &&
          first !== null &&
          'recipientIdentityId' in first &&
          typeof first.recipientIdentityId === 'string'
        ) {
          expect(
            protocolEventSchema.safeParse({
              ...event,
              recipientSplits: [
                {
                  ...first,
                  recipientIdentityId: first.recipientIdentityId.replace(
                    networkId,
                    secondNetworkId,
                  ),
                },
                ...rest,
              ],
            }).success,
            `${family}.recipientSplits.recipientIdentityId`,
          ).toBe(false);
        }
      }
    }
  });

  it('requires an identity creation address to match its identity ID', () => {
    const event = fixtures.find(({ family }) => family === 'identity')?.event;
    expect(event).toBeDefined();
    expect(
      protocolEventSchema.safeParse({ ...event, identityAddress: publicKey(99) }).success,
    ).toBe(false);
  });
});

function base(seed: number) {
  return {
    networkId,
    programId,
    transactionSignature: transactionSignature(seed),
    transactionIndex: seed,
    slot: 10n,
    logIndex: 0,
    blockTime: '2026-07-28T16:00:00.000Z',
    finalized: true as const,
  };
}

function fixture(family: string, event: Readonly<Record<string, unknown>>) {
  return { family, event };
}

function identity(address: string): string {
  return `swid:v1:${networkId}:${address}`;
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

function transactionSignature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => seed));
}

function digest(seed: number): string {
  return encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => seed));
}
