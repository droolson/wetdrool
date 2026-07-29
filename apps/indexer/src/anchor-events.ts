import bs58 from 'bs58';

/**
 * Generated from target/idl/social_protocol.json (Anchor 0.32.1 IDL spec 0.1.0).
 * This checked-in artifact deliberately contains only event discriminators and
 * layouts, so production ingestion never depends on ignored build output.
 */
export const SOCIAL_PROTOCOL_EVENT_LAYOUT = {
  programId: '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD',
  events: {
    BlockStateChanged: [172, 189, 73, 239, 129, 119, 51, 239],
    CommunityCreated: [218, 186, 205, 161, 125, 58, 101, 64],
    CommunityGovernanceUpdated: [196, 91, 184, 153, 102, 11, 202, 176],
    CommunityMembershipChanged: [140, 136, 245, 151, 152, 11, 75, 249],
    DelegationCreated: [20, 93, 12, 34, 227, 63, 100, 136],
    DelegationRevoked: [59, 158, 142, 49, 164, 116, 220, 8],
    FollowStateChanged: [134, 25, 152, 20, 65, 243, 107, 118],
    HandleClaimed: [23, 183, 225, 13, 62, 87, 199, 150],
    HandleReleased: [46, 27, 52, 76, 216, 175, 174, 128],
    IdentityCreated: [247, 185, 231, 174, 133, 94, 200, 142],
    IdentityDeactivated: [19, 21, 51, 7, 82, 100, 132, 255],
    PaymentAuthorityRotated: [163, 98, 210, 236, 171, 187, 204, 62],
    PaymentConfigInitialized: [12, 146, 193, 194, 231, 51, 227, 9],
    PaymentConfigUpdated: [186, 235, 216, 17, 194, 224, 181, 66],
    PostReferencePublished: [65, 16, 116, 252, 204, 196, 161, 100],
    PostTombstoned: [228, 246, 184, 38, 105, 108, 147, 36],
    ProposalCreated: [186, 8, 160, 108, 81, 13, 51, 206],
    ProposalFinalized: [159, 104, 210, 220, 86, 209, 61, 51],
    ProfileReferenceUpdated: [251, 63, 9, 200, 203, 176, 143, 98],
    ProtocolInitialized: [173, 122, 168, 254, 9, 118, 76, 132],
    ReactionStateChanged: [183, 83, 52, 150, 209, 41, 13, 94],
    RecoveryApproved: [97, 50, 186, 253, 67, 239, 34, 47],
    RecoveryCancelled: [191, 25, 236, 86, 25, 77, 117, 96],
    RecoveryExecuted: [161, 218, 6, 191, 85, 217, 12, 144],
    RecoveryPolicyConfigured: [60, 86, 49, 242, 0, 181, 29, 253],
    RecoveryPolicyDisabled: [34, 63, 210, 140, 136, 130, 70, 177],
    RecoveryRequested: [127, 3, 38, 230, 145, 28, 53, 141],
    RootAuthorityRotated: [45, 188, 81, 157, 31, 106, 151, 77],
    SubscriptionOfferingCreated: [55, 231, 216, 246, 111, 122, 144, 233],
    SubscriptionOfferingRetired: [168, 40, 69, 55, 165, 163, 200, 123],
    SubscriptionSettled: [146, 48, 250, 127, 131, 180, 247, 174],
    VoteCast: [39, 53, 195, 104, 188, 17, 225, 213],
    WokeTipSettled: [142, 81, 75, 163, 58, 30, 248, 115],
  },
} as const;

export interface DecodedPaymentSplit {
  readonly recipientIdentity: string;
  readonly destination: string;
  readonly basisPoints: number;
}

export type DecodedAnchorEvent =
  | {
      readonly kind: 'protocol-initialized';
      readonly eventVersion: number;
      readonly config: string;
      readonly initializedAtSlot: bigint;
    }
  | {
      readonly kind: 'identity-created';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly rootAuthority: string;
      readonly identityNonce: Uint8Array;
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'identity-deactivated';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly rootAuthority: string;
      readonly identitySequence: bigint;
      readonly deactivatedAtSlot: bigint;
    }
  | {
      readonly kind: 'handle-claimed';
      readonly eventVersion: number;
      readonly config: string;
      readonly handleClaim: string;
      readonly identity: string;
      readonly authority: string;
      readonly identitySequence: bigint;
      readonly handleHash: Uint8Array;
      readonly handle: string;
      readonly claimedAtSlot: bigint;
    }
  | {
      readonly kind: 'handle-released';
      readonly eventVersion: number;
      readonly config: string;
      readonly handleClaim: string;
      readonly identity: string;
      readonly authority: string;
      readonly identitySequence: bigint;
      readonly handleHash: Uint8Array;
      readonly handle: string;
      readonly releasedAtSlot: bigint;
    }
  | {
      readonly kind: 'profile-updated';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly authority: string;
      readonly sequence: bigint;
      readonly previousManifestHash: Uint8Array;
      readonly manifestHash: Uint8Array;
      readonly manifestUri: string;
      readonly updatedAtSlot: bigint;
      /**
       * Appended to ProfileReferenceUpdated by the protected-profile rollout.
       * Its absence is retained only for replaying pre-activation legacy events.
       */
      readonly profileSchemaVersion?: number;
    }
  | {
      readonly kind: 'post-published';
      readonly eventVersion: number;
      readonly config: string;
      readonly postReference: string;
      readonly authorIdentity: string;
      readonly authority: string;
      readonly postNonce: Uint8Array;
      readonly authorSequence: bigint;
      readonly manifestHash: Uint8Array;
      readonly manifestUri: string;
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'follow-changed';
      readonly eventVersion: number;
      readonly config: string;
      readonly followEdge: string;
      readonly followerIdentity: string;
      readonly subjectIdentity: string;
      readonly followerSequence: bigint;
      readonly edgeStateSequence: bigint;
      readonly active: boolean;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'post-tombstoned';
      readonly eventVersion: number;
      readonly config: string;
      readonly tombstone: string;
      readonly targetPost: string;
      readonly authorIdentity: string;
      readonly authorSequence: bigint;
      readonly targetHash: Uint8Array;
      readonly reason: 'user-request' | 'safety' | 'other';
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'root-authority-rotated';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly previousRootAuthority: string;
      readonly newRootAuthority: string;
      readonly identitySequence: bigint;
      readonly rotationCount: bigint;
      readonly rotatedAtSlot: bigint;
    }
  | {
      readonly kind: 'delegation-created';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly delegation: string;
      readonly delegateAuthority: string;
      readonly delegationSequence: bigint;
      readonly identitySequence: bigint;
      readonly scopes: number;
      readonly issuedAtRootRotationCount: bigint;
      readonly expiresAtSlot: bigint;
      readonly issuedAtSlot: bigint;
    }
  | {
      readonly kind: 'delegation-revoked';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly delegation: string;
      readonly delegateAuthority: string;
      readonly delegationSequence: bigint;
      readonly identitySequence: bigint;
      readonly delegationStateSequence: bigint;
      readonly revokedAtSlot: bigint;
    }
  | {
      readonly kind: 'block-changed';
      readonly eventVersion: number;
      readonly config: string;
      readonly blockEdge: string;
      readonly blockerIdentity: string;
      readonly subjectIdentity: string;
      readonly authority: string;
      readonly blockerSequence: bigint;
      readonly edgeStateSequence: bigint;
      readonly active: boolean;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'community-created';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly creatorIdentity: string;
      readonly authority: string;
      readonly communityNonce: Uint8Array;
      readonly creatorSequence: bigint;
      readonly manifestHash: Uint8Array;
      readonly manifestUri: string;
      readonly governanceVersion: number;
      readonly governanceStrategyHash: Uint8Array;
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'community-governance-updated';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly creatorIdentity: string;
      readonly authority: string;
      readonly creatorSequence: bigint;
      readonly previousGovernanceVersion: number;
      readonly governanceVersion: number;
      readonly previousStrategyHash: Uint8Array;
      readonly governanceStrategyHash: Uint8Array;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'community-membership-changed';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly membership: string;
      readonly memberIdentity: string;
      readonly assignedByIdentity: string;
      readonly authority: string;
      readonly authoritySequence: bigint;
      readonly membershipStateSequence: bigint;
      readonly roles: number;
      readonly active: boolean;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'reaction-changed';
      readonly eventVersion: number;
      readonly config: string;
      readonly reactionReference: string;
      readonly reactorIdentity: string;
      readonly targetPost: string;
      readonly authority: string;
      readonly reactionKind: number;
      readonly reactorSequence: bigint;
      readonly reactionStateSequence: bigint;
      readonly active: boolean;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'recovery-policy-configured';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly rootAuthority: string;
      readonly policySequence: bigint;
      readonly identitySequence: bigint;
      readonly rootRotationCount: bigint;
      readonly guardians: readonly string[];
      readonly threshold: number;
      readonly delaySlots: bigint;
      readonly configuredAtSlot: bigint;
    }
  | {
      readonly kind: 'recovery-policy-disabled';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly rootAuthority: string;
      readonly policySequence: bigint;
      readonly identitySequence: bigint;
      readonly rootRotationCount: bigint;
      readonly disabledAtSlot: bigint;
    }
  | {
      readonly kind: 'recovery-requested';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly recoveryRequest: string;
      readonly requestingGuardian: string;
      readonly requestNonce: Uint8Array;
      readonly policySequence: bigint;
      readonly currentRootAuthority: string;
      readonly identitySequence: bigint;
      readonly rootRotationCount: bigint;
      readonly targetRootAuthority: string;
      readonly threshold: number;
      readonly guardianCount: number;
      readonly approvalCount: number;
      readonly requestedAtSlot: bigint;
      readonly executeAfterSlot: bigint;
    }
  | {
      readonly kind: 'recovery-approved';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly recoveryRequest: string;
      readonly guardian: string;
      readonly guardianIndex: number;
      readonly policySequence: bigint;
      readonly approvalCount: number;
      readonly threshold: number;
      readonly approvedAtSlot: bigint;
    }
  | {
      readonly kind: 'recovery-cancelled';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly recoveryRequest: string;
      readonly cancelledByRootAuthority: string;
      readonly targetRootAuthority: string;
      readonly policySequence: bigint;
      readonly identitySequence: bigint;
      readonly rootRotationCount: bigint;
      readonly cancelledAtSlot: bigint;
    }
  | {
      readonly kind: 'recovery-executed';
      readonly eventVersion: number;
      readonly config: string;
      readonly identity: string;
      readonly recoveryPolicy: string;
      readonly recoveryRequest: string;
      readonly executor: string;
      readonly previousRootAuthority: string;
      readonly newRootAuthority: string;
      readonly policySequence: bigint;
      readonly approvalCount: number;
      readonly threshold: number;
      readonly identitySequence: bigint;
      readonly rotationCount: bigint;
      readonly executedAtSlot: bigint;
    }
  | {
      readonly kind: 'payment-config-initialized';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly upgradeAuthority: string;
      readonly paymentAuthority: string;
      readonly feeDestination: string;
      readonly feeBps: number;
      readonly policySequence: bigint;
      readonly enabled: boolean;
      readonly initializedAtSlot: bigint;
    }
  | {
      readonly kind: 'payment-config-updated';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly authority: string;
      readonly previousFeeDestination: string;
      readonly feeDestination: string;
      readonly previousFeeBps: number;
      readonly feeBps: number;
      readonly previousEnabled: boolean;
      readonly enabled: boolean;
      readonly policySequence: bigint;
      readonly updatedAtSlot: bigint;
    }
  | {
      readonly kind: 'payment-authority-rotated';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly previousAuthority: string;
      readonly newAuthority: string;
      readonly policySequence: bigint;
      readonly rotatedAtSlot: bigint;
    }
  | {
      readonly kind: 'subscription-offering-created';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly offering: string;
      readonly creatorIdentity: string;
      readonly rootAuthority: string;
      readonly offeringNonce: Uint8Array;
      readonly manifestHash: Uint8Array;
      readonly manifestUri: string;
      readonly priceLamports: bigint;
      readonly billingInterval: 'week';
      readonly recipientSplits: readonly DecodedPaymentSplit[];
      readonly refundPolicyHash: Uint8Array;
      readonly maxProtocolFeeBps: number;
      readonly creatorRootRotationCount: bigint;
      readonly creatorSequence: bigint;
      readonly offeringStateSequence: bigint;
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'subscription-offering-retired';
      readonly eventVersion: number;
      readonly config: string;
      readonly offering: string;
      readonly creatorIdentity: string;
      readonly rootAuthority: string;
      readonly manifestHash: Uint8Array;
      readonly creatorSequence: bigint;
      readonly offeringStateSequence: bigint;
      readonly retiredAtSlot: bigint;
    }
  | {
      readonly kind: 'woke-tip-settled';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly receipt: string;
      readonly payerIdentity: string;
      readonly payerAuthority: string;
      readonly recipientIdentity: string;
      readonly recipientDestination: string;
      readonly receiptNonce: Uint8Array;
      readonly paymentKind: 'woke-tip';
      readonly payerRootRotationCount: bigint;
      readonly paymentPolicySequence: bigint;
      readonly grossLamports: bigint;
      readonly feeBps: number;
      readonly feeDestination: string;
      readonly feeLamports: bigint;
      readonly distributableLamports: bigint;
      readonly recipientLamports: bigint;
      readonly paidAtTimestamp: bigint;
      readonly paidAtSlot: bigint;
    }
  | {
      readonly kind: 'subscription-settled';
      readonly eventVersion: number;
      readonly config: string;
      readonly paymentConfig: string;
      readonly offering: string;
      readonly receipt: string;
      readonly entitlement: string;
      readonly creatorIdentity: string;
      readonly payerIdentity: string;
      readonly payerAuthority: string;
      readonly receiptNonce: Uint8Array;
      readonly paymentKind: 'weekly-subscription';
      readonly payerRootRotationCount: bigint;
      readonly paymentPolicySequence: bigint;
      readonly offeringStateSequence: bigint;
      readonly offeringManifestHash: Uint8Array;
      readonly refundPolicyHash: Uint8Array;
      readonly grossLamports: bigint;
      readonly feeBps: number;
      readonly feeDestination: string;
      readonly feeLamports: bigint;
      readonly distributableLamports: bigint;
      readonly recipientSplits: readonly DecodedPaymentSplit[];
      readonly recipientAmounts: readonly bigint[];
      readonly entitlementStateSequence: bigint;
      readonly settlementCount: bigint;
      readonly entitlementFromTimestamp: bigint;
      readonly entitlementUntilTimestamp: bigint;
      readonly paidAtTimestamp: bigint;
      readonly paidAtSlot: bigint;
    }
  | {
      readonly kind: 'proposal-created';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly proposal: string;
      readonly proposerIdentity: string;
      readonly authority: string;
      readonly proposerSequence: bigint;
      readonly previousCommunitySequence: bigint;
      readonly manifestHash: Uint8Array;
      readonly manifestUri: string;
      readonly governanceVersion: number;
      readonly governanceStrategyHash: Uint8Array;
      readonly votingModel: 'one-active-member-one-vote';
      readonly eligibleMemberCount: bigint;
      readonly opensAtSlot: bigint;
      readonly closesAtSlot: bigint;
      readonly quorumBps: number;
      readonly approvalBps: number;
      readonly proposalStateSequence: bigint;
      readonly createdAtSlot: bigint;
    }
  | {
      readonly kind: 'vote-cast';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly proposal: string;
      readonly vote: string;
      readonly voterIdentity: string;
      readonly membership: string;
      readonly authority: string;
      readonly voterSequence: bigint;
      readonly membershipStateSequence: bigint;
      readonly proposalStateSequence: bigint;
      readonly choice: 'yes' | 'no' | 'abstain';
      readonly yesVotes: bigint;
      readonly noVotes: bigint;
      readonly abstainVotes: bigint;
      readonly castAtSlot: bigint;
    }
  | {
      readonly kind: 'proposal-finalized';
      readonly eventVersion: number;
      readonly config: string;
      readonly community: string;
      readonly proposal: string;
      readonly finalizer: string;
      readonly proposalStateSequence: bigint;
      readonly eligibleMemberCount: bigint;
      readonly yesVotes: bigint;
      readonly noVotes: bigint;
      readonly abstainVotes: bigint;
      readonly participatingVotes: bigint;
      readonly decisiveVotes: bigint;
      readonly quorumBps: number;
      readonly approvalBps: number;
      readonly quorumMet: boolean;
      readonly approvalMet: boolean;
      readonly outcome: 'pending' | 'accepted' | 'rejected';
      readonly finalizedAtSlot: bigint;
    };

export class AnchorEventDecodingError extends Error {
  override readonly name: string = 'AnchorEventDecodingError';
}

export class UnsupportedAnchorEventError extends AnchorEventDecodingError {
  override readonly name: string = 'UnsupportedAnchorEventError';
}

export function decodeAnchorEventLog(encoded: string): DecodedAnchorEvent {
  const bytes = decodeBase64(encoded);
  if (bytes.byteLength < 8) {
    throw new AnchorEventDecodingError('Anchor event data is shorter than its discriminator.');
  }

  const discriminator = bytes.subarray(0, 8);
  const reader = new BorshReader(bytes.subarray(8));
  let event: DecodedAnchorEvent | undefined;

  if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProtocolInitialized)) {
    event = {
      kind: 'protocol-initialized',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      initializedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.IdentityCreated)) {
    event = {
      kind: 'identity-created',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      identityNonce: reader.bytes(16),
      createdAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.IdentityDeactivated)) {
    event = {
      kind: 'identity-deactivated',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      identitySequence: reader.u64(),
      deactivatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.HandleClaimed)) {
    event = {
      kind: 'handle-claimed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      handleClaim: reader.publicKey(),
      identity: reader.publicKey(),
      authority: reader.publicKey(),
      identitySequence: reader.u64(),
      handleHash: reader.bytes(32),
      handle: reader.string(),
      claimedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.HandleReleased)) {
    event = {
      kind: 'handle-released',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      handleClaim: reader.publicKey(),
      identity: reader.publicKey(),
      authority: reader.publicKey(),
      identitySequence: reader.u64(),
      handleHash: reader.bytes(32),
      handle: reader.string(),
      releasedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProfileReferenceUpdated)) {
    const eventVersion = reader.u16();
    const config = reader.publicKey();
    const identity = reader.publicKey();
    const authority = reader.publicKey();
    const sequence = reader.u64();
    const previousManifestHash = reader.bytes(32);
    const manifestHash = reader.bytes(32);
    const manifestUri = reader.string();
    const updatedAtSlot = reader.u64();
    const profileSchemaVersion = reader.optionalTrailingU16();
    event = {
      kind: 'profile-updated',
      eventVersion,
      config,
      identity,
      authority,
      sequence,
      previousManifestHash,
      manifestHash,
      manifestUri,
      updatedAtSlot,
      ...(profileSchemaVersion === undefined ? {} : { profileSchemaVersion }),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PostReferencePublished)) {
    event = {
      kind: 'post-published',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      postReference: reader.publicKey(),
      authorIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      postNonce: reader.bytes(16),
      authorSequence: reader.u64(),
      manifestHash: reader.bytes(32),
      manifestUri: reader.string(),
      createdAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.FollowStateChanged)) {
    event = {
      kind: 'follow-changed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      followEdge: reader.publicKey(),
      followerIdentity: reader.publicKey(),
      subjectIdentity: reader.publicKey(),
      followerSequence: reader.u64(),
      edgeStateSequence: reader.u64(),
      active: reader.boolean(),
      updatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PostTombstoned)) {
    event = {
      kind: 'post-tombstoned',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      tombstone: reader.publicKey(),
      targetPost: reader.publicKey(),
      authorIdentity: reader.publicKey(),
      authorSequence: reader.u64(),
      targetHash: reader.bytes(32),
      reason: reader.tombstoneReason(),
      createdAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RootAuthorityRotated)) {
    event = {
      kind: 'root-authority-rotated',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      previousRootAuthority: reader.publicKey(),
      newRootAuthority: reader.publicKey(),
      identitySequence: reader.u64(),
      rotationCount: reader.u64(),
      rotatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.DelegationCreated)) {
    event = {
      kind: 'delegation-created',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      delegation: reader.publicKey(),
      delegateAuthority: reader.publicKey(),
      delegationSequence: reader.u64(),
      identitySequence: reader.u64(),
      scopes: reader.u16(),
      issuedAtRootRotationCount: reader.u64(),
      expiresAtSlot: reader.u64(),
      issuedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.DelegationRevoked)) {
    event = {
      kind: 'delegation-revoked',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      delegation: reader.publicKey(),
      delegateAuthority: reader.publicKey(),
      delegationSequence: reader.u64(),
      identitySequence: reader.u64(),
      delegationStateSequence: reader.u64(),
      revokedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.BlockStateChanged)) {
    event = {
      kind: 'block-changed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      blockEdge: reader.publicKey(),
      blockerIdentity: reader.publicKey(),
      subjectIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      blockerSequence: reader.u64(),
      edgeStateSequence: reader.u64(),
      active: reader.boolean(),
      updatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityCreated)) {
    event = {
      kind: 'community-created',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      creatorIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      communityNonce: reader.bytes(16),
      creatorSequence: reader.u64(),
      manifestHash: reader.bytes(32),
      manifestUri: reader.string(),
      governanceVersion: reader.u16(),
      governanceStrategyHash: reader.bytes(32),
      createdAtSlot: reader.u64(),
    };
  } else if (
    matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityGovernanceUpdated)
  ) {
    event = {
      kind: 'community-governance-updated',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      creatorIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      creatorSequence: reader.u64(),
      previousGovernanceVersion: reader.u16(),
      governanceVersion: reader.u16(),
      previousStrategyHash: reader.bytes(32),
      governanceStrategyHash: reader.bytes(32),
      updatedAtSlot: reader.u64(),
    };
  } else if (
    matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityMembershipChanged)
  ) {
    event = {
      kind: 'community-membership-changed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      membership: reader.publicKey(),
      memberIdentity: reader.publicKey(),
      assignedByIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      authoritySequence: reader.u64(),
      membershipStateSequence: reader.u64(),
      roles: reader.u16(),
      active: reader.boolean(),
      updatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ReactionStateChanged)) {
    event = {
      kind: 'reaction-changed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      reactionReference: reader.publicKey(),
      reactorIdentity: reader.publicKey(),
      targetPost: reader.publicKey(),
      authority: reader.publicKey(),
      reactionKind: reader.u8(),
      reactorSequence: reader.u64(),
      reactionStateSequence: reader.u64(),
      active: reader.boolean(),
      updatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryPolicyConfigured)) {
    event = {
      kind: 'recovery-policy-configured',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      policySequence: reader.u64(),
      identitySequence: reader.u64(),
      rootRotationCount: reader.u64(),
      guardians: reader.publicKeyVector(),
      threshold: reader.u8(),
      delaySlots: reader.u64(),
      configuredAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryPolicyDisabled)) {
    event = {
      kind: 'recovery-policy-disabled',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      policySequence: reader.u64(),
      identitySequence: reader.u64(),
      rootRotationCount: reader.u64(),
      disabledAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryRequested)) {
    event = {
      kind: 'recovery-requested',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      recoveryRequest: reader.publicKey(),
      requestingGuardian: reader.publicKey(),
      requestNonce: reader.bytes(16),
      policySequence: reader.u64(),
      currentRootAuthority: reader.publicKey(),
      identitySequence: reader.u64(),
      rootRotationCount: reader.u64(),
      targetRootAuthority: reader.publicKey(),
      threshold: reader.u8(),
      guardianCount: reader.u8(),
      approvalCount: reader.u8(),
      requestedAtSlot: reader.u64(),
      executeAfterSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryApproved)) {
    event = {
      kind: 'recovery-approved',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      recoveryRequest: reader.publicKey(),
      guardian: reader.publicKey(),
      guardianIndex: reader.u8(),
      policySequence: reader.u64(),
      approvalCount: reader.u8(),
      threshold: reader.u8(),
      approvedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryCancelled)) {
    event = {
      kind: 'recovery-cancelled',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      recoveryRequest: reader.publicKey(),
      cancelledByRootAuthority: reader.publicKey(),
      targetRootAuthority: reader.publicKey(),
      policySequence: reader.u64(),
      identitySequence: reader.u64(),
      rootRotationCount: reader.u64(),
      cancelledAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RecoveryExecuted)) {
    event = {
      kind: 'recovery-executed',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      identity: reader.publicKey(),
      recoveryPolicy: reader.publicKey(),
      recoveryRequest: reader.publicKey(),
      executor: reader.publicKey(),
      previousRootAuthority: reader.publicKey(),
      newRootAuthority: reader.publicKey(),
      policySequence: reader.u64(),
      approvalCount: reader.u8(),
      threshold: reader.u8(),
      identitySequence: reader.u64(),
      rotationCount: reader.u64(),
      executedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentConfigInitialized)) {
    event = {
      kind: 'payment-config-initialized',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      upgradeAuthority: reader.publicKey(),
      paymentAuthority: reader.publicKey(),
      feeDestination: reader.publicKey(),
      feeBps: reader.u16(),
      policySequence: reader.u64(),
      enabled: reader.boolean(),
      initializedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentConfigUpdated)) {
    event = {
      kind: 'payment-config-updated',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      authority: reader.publicKey(),
      previousFeeDestination: reader.publicKey(),
      feeDestination: reader.publicKey(),
      previousFeeBps: reader.u16(),
      feeBps: reader.u16(),
      previousEnabled: reader.boolean(),
      enabled: reader.boolean(),
      policySequence: reader.u64(),
      updatedAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentAuthorityRotated)) {
    event = {
      kind: 'payment-authority-rotated',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      previousAuthority: reader.publicKey(),
      newAuthority: reader.publicKey(),
      policySequence: reader.u64(),
      rotatedAtSlot: reader.u64(),
    };
  } else if (
    matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionOfferingCreated)
  ) {
    event = {
      kind: 'subscription-offering-created',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      offering: reader.publicKey(),
      creatorIdentity: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      offeringNonce: reader.bytes(16),
      manifestHash: reader.bytes(32),
      manifestUri: reader.string(),
      priceLamports: reader.u64(),
      billingInterval: reader.subscriptionInterval(),
      recipientSplits: reader.paymentSplitVector(),
      refundPolicyHash: reader.bytes(32),
      maxProtocolFeeBps: reader.u16(),
      creatorRootRotationCount: reader.u64(),
      creatorSequence: reader.u64(),
      offeringStateSequence: reader.u64(),
      createdAtSlot: reader.u64(),
    };
  } else if (
    matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionOfferingRetired)
  ) {
    event = {
      kind: 'subscription-offering-retired',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      offering: reader.publicKey(),
      creatorIdentity: reader.publicKey(),
      rootAuthority: reader.publicKey(),
      manifestHash: reader.bytes(32),
      creatorSequence: reader.u64(),
      offeringStateSequence: reader.u64(),
      retiredAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.WokeTipSettled)) {
    event = {
      kind: 'woke-tip-settled',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      receipt: reader.publicKey(),
      payerIdentity: reader.publicKey(),
      payerAuthority: reader.publicKey(),
      recipientIdentity: reader.publicKey(),
      recipientDestination: reader.publicKey(),
      receiptNonce: reader.bytes(16),
      paymentKind: reader.wokeTipPaymentKind(),
      payerRootRotationCount: reader.u64(),
      paymentPolicySequence: reader.u64(),
      grossLamports: reader.u64(),
      feeBps: reader.u16(),
      feeDestination: reader.publicKey(),
      feeLamports: reader.u64(),
      distributableLamports: reader.u64(),
      recipientLamports: reader.u64(),
      paidAtTimestamp: reader.i64(),
      paidAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionSettled)) {
    event = {
      kind: 'subscription-settled',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      paymentConfig: reader.publicKey(),
      offering: reader.publicKey(),
      receipt: reader.publicKey(),
      entitlement: reader.publicKey(),
      creatorIdentity: reader.publicKey(),
      payerIdentity: reader.publicKey(),
      payerAuthority: reader.publicKey(),
      receiptNonce: reader.bytes(16),
      paymentKind: reader.subscriptionPaymentKind(),
      payerRootRotationCount: reader.u64(),
      paymentPolicySequence: reader.u64(),
      offeringStateSequence: reader.u64(),
      offeringManifestHash: reader.bytes(32),
      refundPolicyHash: reader.bytes(32),
      grossLamports: reader.u64(),
      feeBps: reader.u16(),
      feeDestination: reader.publicKey(),
      feeLamports: reader.u64(),
      distributableLamports: reader.u64(),
      recipientSplits: reader.paymentSplitVector(),
      recipientAmounts: reader.u64Vector(),
      entitlementStateSequence: reader.u64(),
      settlementCount: reader.u64(),
      entitlementFromTimestamp: reader.i64(),
      entitlementUntilTimestamp: reader.i64(),
      paidAtTimestamp: reader.i64(),
      paidAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProposalCreated)) {
    event = {
      kind: 'proposal-created',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      proposal: reader.publicKey(),
      proposerIdentity: reader.publicKey(),
      authority: reader.publicKey(),
      proposerSequence: reader.u64(),
      previousCommunitySequence: reader.u64(),
      manifestHash: reader.bytes(32),
      manifestUri: reader.string(),
      governanceVersion: reader.u16(),
      governanceStrategyHash: reader.bytes(32),
      votingModel: reader.governanceVotingModel(),
      eligibleMemberCount: reader.u64(),
      opensAtSlot: reader.u64(),
      closesAtSlot: reader.u64(),
      quorumBps: reader.u16(),
      approvalBps: reader.u16(),
      proposalStateSequence: reader.u64(),
      createdAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.VoteCast)) {
    event = {
      kind: 'vote-cast',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      proposal: reader.publicKey(),
      vote: reader.publicKey(),
      voterIdentity: reader.publicKey(),
      membership: reader.publicKey(),
      authority: reader.publicKey(),
      voterSequence: reader.u64(),
      membershipStateSequence: reader.u64(),
      proposalStateSequence: reader.u64(),
      choice: reader.governanceVoteChoice(),
      yesVotes: reader.u64(),
      noVotes: reader.u64(),
      abstainVotes: reader.u64(),
      castAtSlot: reader.u64(),
    };
  } else if (matches(discriminator, SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProposalFinalized)) {
    event = {
      kind: 'proposal-finalized',
      eventVersion: reader.u16(),
      config: reader.publicKey(),
      community: reader.publicKey(),
      proposal: reader.publicKey(),
      finalizer: reader.publicKey(),
      proposalStateSequence: reader.u64(),
      eligibleMemberCount: reader.u64(),
      yesVotes: reader.u64(),
      noVotes: reader.u64(),
      abstainVotes: reader.u64(),
      participatingVotes: reader.u64(),
      decisiveVotes: reader.u64(),
      quorumBps: reader.u16(),
      approvalBps: reader.u16(),
      quorumMet: reader.boolean(),
      approvalMet: reader.boolean(),
      outcome: reader.governanceProposalOutcome(),
      finalizedAtSlot: reader.u64(),
    };
  } else {
    throw new UnsupportedAnchorEventError(
      `Program emitted an unsupported Anchor event discriminator ${Buffer.from(discriminator).toString('hex')}.`,
    );
  }

  reader.assertFinished();
  return event;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new AnchorEventDecodingError('Anchor event log is not canonical base64.');
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function matches(
  actual: Uint8Array,
  expected: readonly [number, number, number, number, number, number, number, number],
): boolean {
  return expected.every((byte, index) => actual[index] === byte);
}

class BorshReader {
  #offset = 0;

  constructor(private readonly value: Uint8Array) {}

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.value.length) {
      throw new AnchorEventDecodingError('Anchor event data ended unexpectedly.');
    }
    const result = this.value.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return result;
  }

  u16(): number {
    const bytes = this.bytes(2);
    return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  }

  u8(): number {
    return this.bytes(1)[0] ?? 0;
  }

  u32(): number {
    const bytes = this.bytes(4);
    return (
      ((bytes[0] ?? 0) |
        ((bytes[1] ?? 0) << 8) |
        ((bytes[2] ?? 0) << 16) |
        ((bytes[3] ?? 0) << 24)) >>>
      0
    );
  }

  u64(): bigint {
    const bytes = this.bytes(8);
    let result = 0n;
    for (let index = 7; index >= 0; index -= 1) {
      result = (result << 8n) | BigInt(bytes[index] ?? 0);
    }
    return result;
  }

  i64(): bigint {
    const unsigned = this.u64();
    return unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
  }

  boolean(): boolean {
    const value = this.bytes(1)[0];
    if (value !== 0 && value !== 1) {
      throw new AnchorEventDecodingError('Anchor event contains an invalid boolean.');
    }
    return value === 1;
  }

  publicKey(): string {
    return bs58.encode(this.bytes(32));
  }

  publicKeyVector(): readonly string[] {
    const length = this.u32();
    if (length > 5) {
      throw new AnchorEventDecodingError('Anchor recovery guardian vector exceeds five entries.');
    }
    return Array.from({ length }, () => this.publicKey());
  }

  paymentSplitVector(): readonly DecodedPaymentSplit[] {
    const length = this.u32();
    if (length > 3) {
      throw new AnchorEventDecodingError('Anchor payment split vector exceeds three entries.');
    }
    return Array.from({ length }, () => ({
      recipientIdentity: this.publicKey(),
      destination: this.publicKey(),
      basisPoints: this.u16(),
    }));
  }

  u64Vector(): readonly bigint[] {
    const length = this.u32();
    if (length > 3) {
      throw new AnchorEventDecodingError('Anchor payment amount vector exceeds three entries.');
    }
    return Array.from({ length }, () => this.u64());
  }

  string(): string {
    const length = this.u32();
    const bytes = this.bytes(length);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new AnchorEventDecodingError('Anchor event contains invalid UTF-8.', {
        cause: error,
      });
    }
  }

  tombstoneReason(): 'user-request' | 'safety' | 'other' {
    const variant = this.bytes(1)[0];
    if (variant === 0) {
      return 'user-request';
    }
    if (variant === 1) {
      return 'safety';
    }
    if (variant === 2) {
      return 'other';
    }
    throw new AnchorEventDecodingError('Anchor event contains an unknown tombstone reason.');
  }

  governanceVotingModel(): 'one-active-member-one-vote' {
    if (this.u8() === 0) {
      return 'one-active-member-one-vote';
    }
    throw new AnchorEventDecodingError('Anchor event contains an unknown governance voting model.');
  }

  governanceVoteChoice(): 'yes' | 'no' | 'abstain' {
    const variant = this.u8();
    if (variant === 0) return 'yes';
    if (variant === 1) return 'no';
    if (variant === 2) return 'abstain';
    throw new AnchorEventDecodingError('Anchor event contains an unknown governance vote choice.');
  }

  governanceProposalOutcome(): 'pending' | 'accepted' | 'rejected' {
    const variant = this.u8();
    if (variant === 0) return 'pending';
    if (variant === 1) return 'accepted';
    if (variant === 2) return 'rejected';
    throw new AnchorEventDecodingError('Anchor event contains an unknown governance outcome.');
  }

  subscriptionInterval(): 'week' {
    if (this.u8() === 0) return 'week';
    throw new AnchorEventDecodingError('Anchor event contains an unknown subscription interval.');
  }

  wokeTipPaymentKind(): 'woke-tip' {
    if (this.u8() === 0) return 'woke-tip';
    throw new AnchorEventDecodingError('Legacy tip event contains a mismatched payment kind.');
  }

  subscriptionPaymentKind(): 'weekly-subscription' {
    if (this.u8() === 1) return 'weekly-subscription';
    throw new AnchorEventDecodingError('Subscription event contains a mismatched payment kind.');
  }

  optionalTrailingU16(): number | undefined {
    const remaining = this.value.byteLength - this.#offset;
    if (remaining === 0) {
      return undefined;
    }
    if (remaining !== 2) {
      throw new AnchorEventDecodingError(
        'Profile reference event has a malformed trailing schema-version commitment.',
      );
    }
    return this.u16();
  }

  assertFinished(): void {
    if (this.#offset !== this.value.byteLength) {
      throw new AnchorEventDecodingError('Anchor event contains trailing bytes.');
    }
  }
}
