import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  cidSchema,
  digestSchema,
  encodeMultibaseBase64Url,
  handleSchema,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  solanaPublicKeySchema,
  timestampSchema,
  transactionSignatureSchema,
} from '@wokesocial/protocol';

import {
  calculatePaymentAllocation,
  MAX_PROTOCOL_FEE_BPS,
  PaymentInvariantError,
  WEEK_SECONDS,
} from './payment-validation.js';

const u16Schema = z.number().int().min(0).max(65_535);
const u8Schema = z.number().int().min(0).max(255);
const nonnegativeU64Schema = z.bigint().nonnegative().max(18_446_744_073_709_551_615n);
const positiveU64Schema = z.bigint().positive().max(18_446_744_073_709_551_615n);
const nonnegativeI64Schema = z.bigint().nonnegative().max(9_223_372_036_854_775_807n);
export const GOVERNANCE_STRATEGY_HASH = 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA' as const;
export const GOVERNANCE_QUORUM_BPS = 5_000 as const;
export const GOVERNANCE_APPROVAL_BPS = 5_001 as const;
const ZERO_DIGEST = 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const paymentNonceSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/u)
  .refine((value) => value !== '0'.repeat(32), 'Payment nonce cannot be zero.');
const paymentFeeBpsSchema = z.number().int().min(0).max(MAX_PROTOCOL_FEE_BPS);
const nonzeroDigestSchema = digestSchema.refine(
  (value) => value !== ZERO_DIGEST,
  'Digest cannot be zero.',
);
const recoveryNonceSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/u)
  .refine((value) => value !== '0'.repeat(32), 'Recovery request nonce cannot be zero.');
const recoveryGuardiansSchema = z
  .array(solanaPublicKeySchema)
  .min(2)
  .max(5)
  .superRefine((guardians, context) => {
    if (new Set(guardians).size !== guardians.length) {
      context.addIssue({ code: 'custom', message: 'Recovery guardians must be distinct.' });
    }
  });
const governanceManifestUriSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 200, 'Manifest URI is too long.')
  .regex(/^[\x21-\x7e]+$/u, 'Manifest URI must contain only visible ASCII characters.')
  .refine((value) => !/[<>"'\\]/u.test(value), 'Manifest URI contains a forbidden character.')
  .refine(
    (value) => /^(?:ipfs|ar|https|local):\/\/.+$/u.test(value),
    'Manifest URI must use ipfs://, ar://, https://, or local://.',
  );
const onchainHandleSchema = handleSchema.refine(
  (handle) => !handle.includes('__'),
  'On-chain handles cannot contain repeated underscores.',
);
const common = {
  networkId: networkIdSchema,
  programId: solanaPublicKeySchema,
  transactionSignature: transactionSignatureSchema,
  transactionIndex: z.number().int().nonnegative().optional(),
  slot: z.bigint().nonnegative(),
  logIndex: z.number().int().nonnegative(),
  blockTime: timestampSchema,
  finalized: z.literal(true),
};

const protocolInitializedEventSchema = z
  .object({
    ...common,
    type: z.literal('protocol-initialized'),
    configAddress: solanaPublicKeySchema,
  })
  .strict();

const identityCreatedEventSchema = z
  .object({
    ...common,
    type: z.literal('identity-created'),
    identityId: identityIdSchema,
    identityAddress: solanaPublicKeySchema,
    rootAuthority: solanaPublicKeySchema,
  })
  .strict();

const handleClaimedEventSchema = z
  .object({
    ...common,
    type: z.literal('handle-claimed'),
    handleClaimAddress: solanaPublicKeySchema,
    identityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    identitySequence: positiveU64Schema,
    handleHash: digestSchema,
    handle: onchainHandleSchema,
  })
  .strict()
  .superRefine(assertHandleHash);

const handleReleasedEventSchema = z
  .object({
    ...common,
    type: z.literal('handle-released'),
    handleClaimAddress: solanaPublicKeySchema,
    identityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    identitySequence: positiveU64Schema,
    handleHash: digestSchema,
    handle: onchainHandleSchema,
  })
  .strict()
  .superRefine(assertHandleHash);

const rootAuthorityRotatedEventSchema = z
  .object({
    ...common,
    type: z.literal('root-authority-rotated'),
    identityId: identityIdSchema,
    previousRootAuthority: solanaPublicKeySchema,
    newRootAuthority: solanaPublicKeySchema,
    identitySequence: z.bigint().positive(),
    rotationCount: z.bigint().positive(),
  })
  .strict()
  .refine(
    (event) => event.previousRootAuthority !== event.newRootAuthority,
    'A root rotation must change the authority.',
  );

const delegationCreatedEventSchema = z
  .object({
    ...common,
    type: z.literal('delegation-created'),
    identityId: identityIdSchema,
    delegationAddress: solanaPublicKeySchema,
    delegateAuthority: solanaPublicKeySchema,
    delegationSequence: z.bigint().nonnegative(),
    identitySequence: z.bigint().positive(),
    scopes: u16Schema.refine((value) => value > 0 && (value & ~0x0f) === 0),
    issuedAtRootRotationCount: z.bigint().nonnegative(),
    expiresAtSlot: z.bigint().positive(),
  })
  .strict()
  .refine((event) => event.expiresAtSlot > event.slot, 'A delegation must expire in the future.');

const delegationRevokedEventSchema = z
  .object({
    ...common,
    type: z.literal('delegation-revoked'),
    identityId: identityIdSchema,
    delegationAddress: solanaPublicKeySchema,
    delegateAuthority: solanaPublicKeySchema,
    delegationSequence: z.bigint().nonnegative(),
    identitySequence: z.bigint().positive(),
    delegationStateSequence: z.bigint().positive(),
  })
  .strict();

const profileUpdatedEventSchema = z
  .object({
    ...common,
    type: z.literal('profile-updated'),
    identityId: identityIdSchema,
    authority: solanaPublicKeySchema.optional(),
    objectId: objectIdSchema,
    cid: cidSchema,
    payloadHash: digestSchema,
    sequence: z.bigint().positive(),
  })
  .strict();

const postPublishedEventSchema = z
  .object({
    ...common,
    type: z.literal('post-published'),
    identityId: identityIdSchema,
    authority: solanaPublicKeySchema.optional(),
    postReference: solanaPublicKeySchema.optional(),
    objectId: objectIdSchema,
    cid: cidSchema,
    payloadHash: digestSchema,
    sequence: z.bigint().positive(),
  })
  .strict();

const followChangedEventSchema = z
  .object({
    ...common,
    type: z.literal('follow-changed'),
    followerIdentityId: identityIdSchema,
    followedIdentityId: identityIdSchema,
    active: z.boolean(),
    sequence: z.bigint().positive(),
  })
  .strict()
  .refine(
    (event) => event.followerIdentityId !== event.followedIdentityId,
    'An identity cannot follow itself.',
  );

const blockChangedEventSchema = z
  .object({
    ...common,
    type: z.literal('block-changed'),
    blockEdgeAddress: solanaPublicKeySchema,
    blockerIdentityId: identityIdSchema,
    subjectIdentityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    blockerSequence: z.bigint().positive(),
    edgeStateSequence: z.bigint().positive(),
    active: z.boolean(),
  })
  .strict()
  .refine(
    (event) => event.blockerIdentityId !== event.subjectIdentityId,
    'An identity cannot block itself.',
  );

const tombstoneEventSchema = z
  .object({
    ...common,
    type: z.literal('tombstoned'),
    identityId: identityIdSchema,
    targetPostReference: solanaPublicKeySchema.optional(),
    targetObjectId: objectIdSchema,
    tombstoneObjectId: objectIdSchema.optional(),
    cid: cidSchema.optional(),
    payloadHash: digestSchema.optional(),
    sequence: z.bigint().positive(),
  })
  .strict()
  .superRefine((event, context) => {
    const manifestFieldCount = [event.tombstoneObjectId, event.cid, event.payloadHash].filter(
      (value) => value !== undefined,
    ).length;
    if (manifestFieldCount !== 0 && manifestFieldCount !== 3) {
      context.addIssue({
        code: 'custom',
        message: 'Tombstone manifest fields must either all be present or all be absent.',
      });
    }
    if (manifestFieldCount === 0 && event.targetPostReference === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['targetPostReference'],
        message: 'An on-chain tombstone must include its target post reference.',
      });
    }
  });

const communityCreatedEventSchema = z
  .object({
    ...common,
    type: z.literal('community-created'),
    communityAddress: solanaPublicKeySchema,
    creatorIdentityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    creatorSequence: z.bigint().positive(),
    manifestCid: cidSchema,
    manifestHash: digestSchema,
    governanceVersion: u16Schema.positive(),
    governanceStrategyHash: digestSchema,
  })
  .strict();

const communityGovernanceUpdatedEventSchema = z
  .object({
    ...common,
    type: z.literal('community-governance-updated'),
    communityAddress: solanaPublicKeySchema,
    creatorIdentityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    creatorSequence: z.bigint().positive(),
    previousGovernanceVersion: u16Schema,
    governanceVersion: u16Schema.positive(),
    previousStrategyHash: digestSchema,
    governanceStrategyHash: digestSchema,
  })
  .strict()
  .refine(
    (event) => event.governanceVersion > event.previousGovernanceVersion,
    'Governance versions must increase.',
  );

const communityMembershipChangedEventSchema = z
  .object({
    ...common,
    type: z.literal('community-membership-changed'),
    communityAddress: solanaPublicKeySchema,
    membershipAddress: solanaPublicKeySchema,
    memberIdentityId: identityIdSchema,
    assignedByIdentityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    authoritySequence: z.bigint().positive(),
    membershipStateSequence: z.bigint().positive(),
    roles: u16Schema.refine((value) => (value & ~0x07) === 0),
    active: z.boolean(),
  })
  .strict()
  .refine(
    (event) =>
      (event.active && event.roles > 0 && (event.roles & 0x01) === 0x01) ||
      (!event.active && event.roles === 0),
    'Active memberships require the member role; inactive memberships require no roles.',
  );

const reactionChangedEventSchema = z
  .object({
    ...common,
    type: z.literal('reaction-changed'),
    reactionReference: solanaPublicKeySchema,
    reactorIdentityId: identityIdSchema,
    targetPostReference: solanaPublicKeySchema,
    authority: solanaPublicKeySchema,
    reactionKind: u8Schema,
    reactorSequence: z.bigint().positive(),
    reactionStateSequence: z.bigint().positive(),
    active: z.boolean(),
  })
  .strict();

const recoveryPolicyConfiguredEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-policy-configured'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    rootAuthority: solanaPublicKeySchema,
    policySequence: positiveU64Schema,
    identitySequence: positiveU64Schema,
    rootRotationCount: nonnegativeU64Schema,
    guardians: recoveryGuardiansSchema,
    threshold: u8Schema.min(2).max(5),
    delaySlots: positiveU64Schema.min(2n).max(1_000_000n),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.threshold > event.guardians.length) {
      context.addIssue({
        code: 'custom',
        path: ['threshold'],
        message: 'Recovery threshold exceeds guardian count.',
      });
    }
    if (event.guardians.includes(event.rootAuthority)) {
      context.addIssue({
        code: 'custom',
        path: ['guardians'],
        message: 'Current root authority cannot be a recovery guardian.',
      });
    }
  });

const recoveryPolicyDisabledEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-policy-disabled'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    rootAuthority: solanaPublicKeySchema,
    policySequence: positiveU64Schema,
    identitySequence: positiveU64Schema,
    rootRotationCount: nonnegativeU64Schema,
  })
  .strict();

const recoveryRequestedEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-requested'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    recoveryRequestAddress: solanaPublicKeySchema,
    requestingGuardian: solanaPublicKeySchema,
    requestNonce: recoveryNonceSchema,
    policySequence: positiveU64Schema,
    currentRootAuthority: solanaPublicKeySchema,
    identitySequence: positiveU64Schema,
    rootRotationCount: nonnegativeU64Schema,
    targetRootAuthority: solanaPublicKeySchema,
    threshold: u8Schema.min(2).max(5),
    guardianCount: u8Schema.min(2).max(5),
    approvalCount: z.literal(1),
    executeAfterSlot: positiveU64Schema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.threshold > event.guardianCount) {
      context.addIssue({
        code: 'custom',
        path: ['threshold'],
        message: 'Recovery threshold exceeds guardian count.',
      });
    }
    if (event.targetRootAuthority === event.currentRootAuthority) {
      context.addIssue({
        code: 'custom',
        path: ['targetRootAuthority'],
        message: 'Recovery target must change the root authority.',
      });
    }
    const delay = event.executeAfterSlot - event.slot;
    if (delay < 2n || delay > 1_000_000n) {
      context.addIssue({
        code: 'custom',
        path: ['executeAfterSlot'],
        message: 'Recovery execution slot is outside the bounded delay.',
      });
    }
  });

const recoveryApprovedEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-approved'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    recoveryRequestAddress: solanaPublicKeySchema,
    guardian: solanaPublicKeySchema,
    guardianIndex: u8Schema.max(4),
    policySequence: positiveU64Schema,
    approvalCount: u8Schema.min(2).max(5),
    threshold: u8Schema.min(2).max(5),
  })
  .strict();

const recoveryCancelledEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-cancelled'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    recoveryRequestAddress: solanaPublicKeySchema,
    cancelledByRootAuthority: solanaPublicKeySchema,
    targetRootAuthority: solanaPublicKeySchema,
    policySequence: positiveU64Schema,
    identitySequence: positiveU64Schema,
    rootRotationCount: nonnegativeU64Schema,
  })
  .strict();

const recoveryExecutedEventSchema = z
  .object({
    ...common,
    type: z.literal('recovery-executed'),
    identityId: identityIdSchema,
    recoveryPolicyAddress: solanaPublicKeySchema,
    recoveryRequestAddress: solanaPublicKeySchema,
    executor: solanaPublicKeySchema,
    previousRootAuthority: solanaPublicKeySchema,
    newRootAuthority: solanaPublicKeySchema,
    policySequence: positiveU64Schema,
    approvalCount: u8Schema.min(2).max(5),
    threshold: u8Schema.min(2).max(5),
    identitySequence: positiveU64Schema,
    rotationCount: positiveU64Schema,
  })
  .strict()
  .refine(
    (event) =>
      event.previousRootAuthority !== event.newRootAuthority &&
      event.approvalCount >= event.threshold,
    'Recovery execution must change root after reaching threshold.',
  );

const proposalCreatedEventSchema = z
  .object({
    ...common,
    type: z.literal('proposal-created'),
    communityAddress: solanaPublicKeySchema,
    proposalAddress: solanaPublicKeySchema,
    proposerIdentityId: identityIdSchema,
    authority: solanaPublicKeySchema,
    proposerSequence: positiveU64Schema,
    previousCommunitySequence: nonnegativeU64Schema,
    manifestHash: digestSchema,
    manifestUri: governanceManifestUriSchema,
    governanceVersion: u16Schema.positive(),
    governanceStrategyHash: digestSchema,
    votingModel: z.literal('one-active-member-one-vote'),
    eligibleMemberCount: positiveU64Schema,
    opensAtSlot: nonnegativeU64Schema,
    closesAtSlot: positiveU64Schema,
    quorumBps: z.literal(GOVERNANCE_QUORUM_BPS),
    approvalBps: z.literal(GOVERNANCE_APPROVAL_BPS),
    proposalStateSequence: z.literal(1n),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.governanceStrategyHash !== GOVERNANCE_STRATEGY_HASH) {
      context.addIssue({
        code: 'custom',
        path: ['governanceStrategyHash'],
        message: 'Proposal must use the canonical governance strategy.',
      });
    }
    if (event.manifestHash === ZERO_DIGEST) {
      context.addIssue({
        code: 'custom',
        path: ['manifestHash'],
        message: 'Proposal manifest hash cannot be zero.',
      });
    }
    if (event.proposerSequence <= event.previousCommunitySequence) {
      context.addIssue({
        code: 'custom',
        path: ['proposerSequence'],
        message: 'Proposer sequence must advance the community sequence.',
      });
    }
    if (event.opensAtSlot < event.slot || event.opensAtSlot - event.slot > 100_000n) {
      context.addIssue({
        code: 'custom',
        path: ['opensAtSlot'],
        message: 'Proposal opening slot is outside the supported start-delay window.',
      });
    }
    const duration = event.closesAtSlot - event.opensAtSlot;
    if (duration < 2n || duration > 1_000_000n) {
      context.addIssue({
        code: 'custom',
        path: ['closesAtSlot'],
        message: 'Proposal voting duration must be between 2 and 1,000,000 slots.',
      });
    }
  });

const voteCastEventSchema = z
  .object({
    ...common,
    type: z.literal('vote-cast'),
    communityAddress: solanaPublicKeySchema,
    proposalAddress: solanaPublicKeySchema,
    voteAddress: solanaPublicKeySchema,
    voterIdentityId: identityIdSchema,
    membershipAddress: solanaPublicKeySchema,
    authority: solanaPublicKeySchema,
    voterSequence: positiveU64Schema,
    membershipStateSequence: positiveU64Schema,
    proposalStateSequence: positiveU64Schema,
    choice: z.enum(['yes', 'no', 'abstain']),
    yesVotes: nonnegativeU64Schema,
    noVotes: nonnegativeU64Schema,
    abstainVotes: nonnegativeU64Schema,
  })
  .strict()
  .refine(
    (event) => event.yesVotes + event.noVotes + event.abstainVotes > 0n,
    'A vote event must include a non-zero post-vote tally.',
  );

const proposalFinalizedEventSchema = z
  .object({
    ...common,
    type: z.literal('proposal-finalized'),
    communityAddress: solanaPublicKeySchema,
    proposalAddress: solanaPublicKeySchema,
    finalizer: solanaPublicKeySchema,
    proposalStateSequence: positiveU64Schema,
    eligibleMemberCount: positiveU64Schema,
    yesVotes: nonnegativeU64Schema,
    noVotes: nonnegativeU64Schema,
    abstainVotes: nonnegativeU64Schema,
    participatingVotes: nonnegativeU64Schema,
    decisiveVotes: nonnegativeU64Schema,
    quorumBps: z.literal(GOVERNANCE_QUORUM_BPS),
    approvalBps: z.literal(GOVERNANCE_APPROVAL_BPS),
    quorumMet: z.boolean(),
    approvalMet: z.boolean(),
    outcome: z.enum(['accepted', 'rejected']),
  })
  .strict()
  .superRefine((event, context) => {
    const participating = event.yesVotes + event.noVotes + event.abstainVotes;
    const decisive = event.yesVotes + event.noVotes;
    const quorumMet =
      participating * 10_000n >= event.eligibleMemberCount * BigInt(event.quorumBps);
    const approvalMet =
      decisive > 0n && event.yesVotes * 10_000n >= decisive * BigInt(event.approvalBps);
    const outcome = quorumMet && approvalMet ? 'accepted' : 'rejected';
    const mismatches: readonly [keyof typeof event, boolean, string][] = [
      ['participatingVotes', event.participatingVotes !== participating, 'Participating tally'],
      ['decisiveVotes', event.decisiveVotes !== decisive, 'Decisive tally'],
      ['quorumMet', event.quorumMet !== quorumMet, 'Quorum result'],
      ['approvalMet', event.approvalMet !== approvalMet, 'Approval result'],
      ['outcome', event.outcome !== outcome, 'Proposal outcome'],
    ];
    for (const [path, mismatch, label] of mismatches) {
      if (mismatch) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${label} does not match the canonical vote calculation.`,
        });
      }
    }
  });

const paymentRecipientSplitSchema = z
  .object({
    recipientIdentityId: identityIdSchema,
    destination: solanaPublicKeySchema,
    basisPoints: z.number().int().positive().max(10_000),
  })
  .strict();

const paymentConfigInitializedEventSchema = z
  .object({
    ...common,
    type: z.literal('payment-config-initialized'),
    paymentConfigAddress: solanaPublicKeySchema,
    upgradeAuthority: solanaPublicKeySchema,
    paymentAuthority: solanaPublicKeySchema,
    feeDestination: solanaPublicKeySchema,
    feeBps: paymentFeeBpsSchema,
    policySequence: z.literal(1n),
    enabled: z.literal(false),
  })
  .strict();

const paymentConfigUpdatedEventSchema = z
  .object({
    ...common,
    type: z.literal('payment-config-updated'),
    paymentConfigAddress: solanaPublicKeySchema,
    authority: solanaPublicKeySchema,
    previousFeeDestination: solanaPublicKeySchema,
    feeDestination: solanaPublicKeySchema,
    previousFeeBps: paymentFeeBpsSchema,
    feeBps: paymentFeeBpsSchema,
    previousEnabled: z.boolean(),
    enabled: z.boolean(),
    policySequence: positiveU64Schema,
  })
  .strict()
  .refine(
    (event) =>
      event.previousFeeDestination !== event.feeDestination ||
      event.previousFeeBps !== event.feeBps ||
      event.previousEnabled !== event.enabled,
    'Payment policy update must change a policy field.',
  );

const paymentAuthorityRotatedEventSchema = z
  .object({
    ...common,
    type: z.literal('payment-authority-rotated'),
    paymentConfigAddress: solanaPublicKeySchema,
    previousAuthority: solanaPublicKeySchema,
    newAuthority: solanaPublicKeySchema,
    policySequence: positiveU64Schema,
  })
  .strict()
  .refine(
    (event) => event.previousAuthority !== event.newAuthority,
    'Payment authority rotation must change the authority.',
  );

const subscriptionOfferingCreatedEventSchema = z
  .object({
    ...common,
    type: z.literal('subscription-offering-created'),
    paymentConfigAddress: solanaPublicKeySchema,
    offeringAddress: solanaPublicKeySchema,
    creatorIdentityId: identityIdSchema,
    rootAuthority: solanaPublicKeySchema,
    offeringNonce: paymentNonceSchema,
    manifestHash: nonzeroDigestSchema,
    manifestUri: governanceManifestUriSchema,
    priceLamports: positiveU64Schema,
    billingInterval: z.literal('week'),
    recipientSplits: z.array(paymentRecipientSplitSchema).min(1).max(3),
    refundPolicyHash: nonzeroDigestSchema,
    maxProtocolFeeBps: paymentFeeBpsSchema,
    creatorRootRotationCount: nonnegativeU64Schema,
    creatorSequence: positiveU64Schema,
    offeringStateSequence: z.literal(1n),
  })
  .strict()
  .superRefine((event, context) => {
    assertPaymentSplits(
      event.recipientSplits,
      event.priceLamports,
      event.maxProtocolFeeBps,
      context,
    );
    if (
      !event.recipientSplits.some(
        (split) =>
          split.recipientIdentityId === event.creatorIdentityId &&
          split.destination === event.rootAuthority,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recipientSplits'],
        message: 'Subscription splits must include the creator root authority.',
      });
    }
  });

const subscriptionOfferingRetiredEventSchema = z
  .object({
    ...common,
    type: z.literal('subscription-offering-retired'),
    offeringAddress: solanaPublicKeySchema,
    creatorIdentityId: identityIdSchema,
    rootAuthority: solanaPublicKeySchema,
    manifestHash: nonzeroDigestSchema,
    creatorSequence: positiveU64Schema,
    offeringStateSequence: positiveU64Schema,
  })
  .strict();

const wokeTipSettledEventSchema = z
  .object({
    ...common,
    type: z.literal('woke-tip-settled'),
    paymentConfigAddress: solanaPublicKeySchema,
    receiptAddress: solanaPublicKeySchema,
    payerIdentityId: identityIdSchema,
    payerAuthority: solanaPublicKeySchema,
    recipientIdentityId: identityIdSchema,
    recipientDestination: solanaPublicKeySchema,
    receiptNonce: paymentNonceSchema,
    paymentKind: z.literal('woke-tip'),
    payerRootRotationCount: nonnegativeU64Schema,
    paymentPolicySequence: positiveU64Schema,
    grossLamports: positiveU64Schema,
    feeBps: paymentFeeBpsSchema,
    feeDestination: solanaPublicKeySchema,
    feeLamports: nonnegativeU64Schema,
    distributableLamports: positiveU64Schema,
    recipientLamports: positiveU64Schema,
    paidAtTimestamp: nonnegativeI64Schema,
  })
  .strict()
  .superRefine((event, context) => {
    const split = {
      recipientIdentityId: event.recipientIdentityId,
      recipientIdentityAddress: identityAddress(event.recipientIdentityId),
      destination: event.recipientDestination,
      basisPoints: 10_000,
    };
    assertPaymentAllocation(
      event.grossLamports,
      event.feeBps,
      [split],
      event.feeLamports,
      event.distributableLamports,
      [event.recipientLamports],
      context,
    );
    if (
      event.payerIdentityId === event.recipientIdentityId ||
      event.payerAuthority === event.feeDestination ||
      event.payerAuthority === event.recipientDestination ||
      event.feeDestination === event.recipientDestination
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recipientDestination'],
        message: 'Payment source, fee, and recipient destinations cannot alias.',
      });
    }
  });

const subscriptionSettledEventSchema = z
  .object({
    ...common,
    type: z.literal('subscription-settled'),
    paymentConfigAddress: solanaPublicKeySchema,
    offeringAddress: solanaPublicKeySchema,
    receiptAddress: solanaPublicKeySchema,
    entitlementAddress: solanaPublicKeySchema,
    creatorIdentityId: identityIdSchema,
    payerIdentityId: identityIdSchema,
    payerAuthority: solanaPublicKeySchema,
    receiptNonce: paymentNonceSchema,
    paymentKind: z.literal('weekly-subscription'),
    payerRootRotationCount: nonnegativeU64Schema,
    paymentPolicySequence: positiveU64Schema,
    offeringStateSequence: positiveU64Schema,
    offeringManifestHash: nonzeroDigestSchema,
    refundPolicyHash: nonzeroDigestSchema,
    grossLamports: positiveU64Schema,
    feeBps: paymentFeeBpsSchema,
    feeDestination: solanaPublicKeySchema,
    feeLamports: nonnegativeU64Schema,
    distributableLamports: positiveU64Schema,
    recipientSplits: z.array(paymentRecipientSplitSchema).min(1).max(3),
    recipientAmounts: z.array(positiveU64Schema).min(1).max(3),
    entitlementStateSequence: positiveU64Schema,
    settlementCount: positiveU64Schema,
    entitlementFromTimestamp: nonnegativeI64Schema,
    entitlementUntilTimestamp: nonnegativeI64Schema,
    paidAtTimestamp: nonnegativeI64Schema,
  })
  .strict()
  .superRefine((event, context) => {
    assertPaymentAllocation(
      event.grossLamports,
      event.feeBps,
      event.recipientSplits.map((split) => ({
        ...split,
        recipientIdentityAddress: identityAddress(split.recipientIdentityId),
      })),
      event.feeLamports,
      event.distributableLamports,
      event.recipientAmounts,
      context,
    );
    if (
      event.entitlementUntilTimestamp - event.entitlementFromTimestamp !== WEEK_SECONDS ||
      event.entitlementFromTimestamp < event.paidAtTimestamp
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entitlementUntilTimestamp'],
        message: 'Subscription event contains an invalid weekly entitlement window.',
      });
    }
    if (
      event.recipientSplits.some(
        (split) =>
          split.recipientIdentityId === event.payerIdentityId ||
          split.destination === event.payerAuthority ||
          split.destination === event.feeDestination,
      ) ||
      event.payerAuthority === event.feeDestination
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recipientSplits'],
        message: 'Payment source, fee, and recipient destinations cannot alias.',
      });
    }
  });

export const protocolEventSchema = z
  .discriminatedUnion('type', [
    protocolInitializedEventSchema,
    identityCreatedEventSchema,
    handleClaimedEventSchema,
    handleReleasedEventSchema,
    rootAuthorityRotatedEventSchema,
    delegationCreatedEventSchema,
    delegationRevokedEventSchema,
    profileUpdatedEventSchema,
    postPublishedEventSchema,
    followChangedEventSchema,
    blockChangedEventSchema,
    tombstoneEventSchema,
    communityCreatedEventSchema,
    communityGovernanceUpdatedEventSchema,
    communityMembershipChangedEventSchema,
    reactionChangedEventSchema,
    recoveryPolicyConfiguredEventSchema,
    recoveryPolicyDisabledEventSchema,
    recoveryRequestedEventSchema,
    recoveryApprovedEventSchema,
    recoveryCancelledEventSchema,
    recoveryExecutedEventSchema,
    proposalCreatedEventSchema,
    voteCastEventSchema,
    proposalFinalizedEventSchema,
    paymentConfigInitializedEventSchema,
    paymentConfigUpdatedEventSchema,
    paymentAuthorityRotatedEventSchema,
    subscriptionOfferingCreatedEventSchema,
    subscriptionOfferingRetiredEventSchema,
    wokeTipSettledEventSchema,
    subscriptionSettledEventSchema,
  ])
  .superRefine(assertNetworkBindings);

export type ProtocolInitializedEvent = z.infer<typeof protocolInitializedEventSchema>;
export type IdentityCreatedEvent = z.infer<typeof identityCreatedEventSchema>;
export type HandleClaimedEvent = z.infer<typeof handleClaimedEventSchema>;
export type HandleReleasedEvent = z.infer<typeof handleReleasedEventSchema>;
export type RootAuthorityRotatedEvent = z.infer<typeof rootAuthorityRotatedEventSchema>;
export type DelegationCreatedEvent = z.infer<typeof delegationCreatedEventSchema>;
export type DelegationRevokedEvent = z.infer<typeof delegationRevokedEventSchema>;
export type ProfileUpdatedEvent = z.infer<typeof profileUpdatedEventSchema>;
export type PostPublishedEvent = z.infer<typeof postPublishedEventSchema>;
export type FollowChangedEvent = z.infer<typeof followChangedEventSchema>;
export type BlockChangedEvent = z.infer<typeof blockChangedEventSchema>;
export type TombstoneEvent = z.infer<typeof tombstoneEventSchema>;
export type CommunityCreatedEvent = z.infer<typeof communityCreatedEventSchema>;
export type CommunityGovernanceUpdatedEvent = z.infer<typeof communityGovernanceUpdatedEventSchema>;
export type CommunityMembershipChangedEvent = z.infer<typeof communityMembershipChangedEventSchema>;
export type ReactionChangedEvent = z.infer<typeof reactionChangedEventSchema>;
export type RecoveryPolicyConfiguredEvent = z.infer<typeof recoveryPolicyConfiguredEventSchema>;
export type RecoveryPolicyDisabledEvent = z.infer<typeof recoveryPolicyDisabledEventSchema>;
export type RecoveryRequestedEvent = z.infer<typeof recoveryRequestedEventSchema>;
export type RecoveryApprovedEvent = z.infer<typeof recoveryApprovedEventSchema>;
export type RecoveryCancelledEvent = z.infer<typeof recoveryCancelledEventSchema>;
export type RecoveryExecutedEvent = z.infer<typeof recoveryExecutedEventSchema>;
export type ProposalCreatedEvent = z.infer<typeof proposalCreatedEventSchema>;
export type VoteCastEvent = z.infer<typeof voteCastEventSchema>;
export type ProposalFinalizedEvent = z.infer<typeof proposalFinalizedEventSchema>;
export type PaymentConfigInitializedEvent = z.infer<typeof paymentConfigInitializedEventSchema>;
export type PaymentConfigUpdatedEvent = z.infer<typeof paymentConfigUpdatedEventSchema>;
export type PaymentAuthorityRotatedEvent = z.infer<typeof paymentAuthorityRotatedEventSchema>;
export type SubscriptionOfferingCreatedEvent = z.infer<
  typeof subscriptionOfferingCreatedEventSchema
>;
export type SubscriptionOfferingRetiredEvent = z.infer<
  typeof subscriptionOfferingRetiredEventSchema
>;
export type WokeTipSettledEvent = z.infer<typeof wokeTipSettledEventSchema>;
export type SubscriptionSettledEvent = z.infer<typeof subscriptionSettledEventSchema>;
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;

export function compareEventOrder(left: ProtocolEvent, right: ProtocolEvent): number {
  if (left.slot !== right.slot) {
    return left.slot < right.slot ? -1 : 1;
  }
  if (
    left.transactionIndex !== undefined &&
    right.transactionIndex !== undefined &&
    left.transactionIndex !== right.transactionIndex
  ) {
    return left.transactionIndex - right.transactionIndex;
  }
  const signature = left.transactionSignature.localeCompare(right.transactionSignature);
  return signature === 0 ? left.logIndex - right.logIndex : signature;
}

function assertHandleHash(
  event: { readonly handle: string; readonly handleHash: string },
  context: z.RefinementCtx,
): void {
  const digest = createHash('sha256').update(event.handle, 'utf8').digest();
  if (event.handleHash !== encodeMultibaseBase64Url(digest)) {
    context.addIssue({
      code: 'custom',
      path: ['handleHash'],
      message: 'Handle hash must be the SHA-256 digest of the normalized handle.',
    });
  }
}

function assertNetworkBindings(
  event: Readonly<Record<string, unknown>> & {
    readonly networkId: string;
    readonly programId: string;
    readonly type: string;
  },
  context: z.RefinementCtx,
): void {
  const networkProgramId = event.networkId.split(':').at(-1);
  if (networkProgramId !== event.programId) {
    context.addIssue({
      code: 'custom',
      path: ['programId'],
      message: 'Event program ID must match the program segment of its network ID.',
    });
  }

  const identityPrefix = `wokesocialid:v1:${event.networkId}:`;
  for (const [field, value] of Object.entries(event)) {
    if (
      typeof value === 'string' &&
      (field === 'identityId' || field.endsWith('IdentityId')) &&
      !value.startsWith(identityPrefix)
    ) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Identity ID must belong to the event network.',
      });
    }
  }

  if ('recipientSplits' in event && Array.isArray(event['recipientSplits'])) {
    for (const [index, split] of event['recipientSplits'].entries()) {
      if (
        typeof split === 'object' &&
        split !== null &&
        'recipientIdentityId' in split &&
        typeof split.recipientIdentityId === 'string' &&
        !split.recipientIdentityId.startsWith(identityPrefix)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recipientSplits', index, 'recipientIdentityId'],
          message: 'Payment recipient identity must belong to the event network.',
        });
      }
    }
  }

  if (
    event.type === 'identity-created' &&
    typeof event['identityId'] === 'string' &&
    typeof event['identityAddress'] === 'string' &&
    event['identityId'].split(':').at(-1) !== event['identityAddress']
  ) {
    context.addIssue({
      code: 'custom',
      path: ['identityAddress'],
      message: 'Identity address must match the address segment of the identity ID.',
    });
  }
}

function assertPaymentSplits(
  splits: readonly z.infer<typeof paymentRecipientSplitSchema>[],
  grossLamports: bigint,
  feeBps: number,
  context: z.RefinementCtx,
): void {
  try {
    calculatePaymentAllocation(
      grossLamports,
      feeBps,
      splits.map((split) => ({
        ...split,
        recipientIdentityAddress: identityAddress(split.recipientIdentityId),
      })),
    );
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['recipientSplits'],
      message:
        error instanceof PaymentInvariantError
          ? error.message
          : 'Payment splits violate the canonical allocation.',
    });
  }
}

function assertPaymentAllocation(
  grossLamports: bigint,
  feeBps: number,
  splits: readonly {
    readonly recipientIdentityId: string;
    readonly recipientIdentityAddress: string;
    readonly destination: string;
    readonly basisPoints: number;
  }[],
  feeLamports: bigint,
  distributableLamports: bigint,
  recipientAmounts: readonly bigint[],
  context: z.RefinementCtx,
): void {
  try {
    const expected = calculatePaymentAllocation(grossLamports, feeBps, splits);
    if (
      expected.feeLamports !== feeLamports ||
      expected.distributableLamports !== distributableLamports ||
      expected.recipientAmounts.length !== recipientAmounts.length ||
      expected.recipientAmounts.some((amount, index) => amount !== recipientAmounts[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recipientAmounts'],
        message: 'Payment amounts do not match the canonical Hamilton allocation.',
      });
    }
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['recipientSplits'],
      message:
        error instanceof PaymentInvariantError ? error.message : 'Payment allocation is invalid.',
    });
  }
}

function identityAddress(identityId: string): string {
  return identityId.split(':').at(-1) ?? '';
}
