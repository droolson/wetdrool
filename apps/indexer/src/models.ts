import type { CommunityContent, PostContent, ProfileContent } from '@wokesocial/protocol';

export interface IdentityProjection {
  readonly identityId: string;
  readonly networkId: string;
  readonly identityAddress: string;
  readonly rootAuthority: string;
  readonly rootRotationCount: bigint;
  readonly active: boolean;
  readonly identitySequence: bigint;
  readonly createdSlot: bigint;
  readonly createdAt: string;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
  readonly deactivatedSlot?: bigint;
  readonly deactivatedAt?: string;
}

export interface ProtocolConfigProjection {
  readonly networkId: string;
  readonly configAddress: string;
  readonly initializedSlot: bigint;
  readonly initializedAt: string;
}

export interface HandleProjection {
  readonly networkId: string;
  readonly handleClaimAddress: string;
  readonly identityId: string;
  readonly authority: string;
  readonly identitySequence: bigint;
  readonly handleHash: string;
  readonly handle: string;
  readonly claimedSlot: bigint;
  readonly claimedAt: string;
}

export interface DelegationProjection {
  readonly identityId: string;
  readonly delegationAddress: string;
  readonly delegateAuthority: string;
  readonly delegationSequence: bigint;
  readonly identitySequence: bigint;
  readonly scopes: number;
  readonly issuedAtRootRotationCount: bigint;
  readonly issuedAtSlot: bigint;
  readonly expiresAtSlot: bigint;
  readonly stateSequence: bigint;
  readonly revokedAtSlot?: bigint;
  readonly updatedAt: string;
}

export interface BlockProjection {
  readonly blockEdgeAddress: string;
  readonly blockerIdentityId: string;
  readonly subjectIdentityId: string;
  readonly authority: string;
  readonly blockerSequence: bigint;
  readonly stateSequence: bigint;
  readonly active: boolean;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

interface CommunityProjectionBase {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly creatorIdentityId: string;
  /** Immutable root authority that signed the CommunityCreated manifest. */
  readonly manifestAuthority: string;
  /** Signer of the latest finalized creator-authorized community action. */
  readonly latestActionAuthority: string;
  readonly creatorSequence: bigint;
  readonly manifestCid: string;
  readonly manifestHash: string;
  /** Immutable governance commitment carried by CommunityCreated. */
  readonly manifestGovernanceVersion: number;
  /** Immutable strategy commitment carried by CommunityCreated. */
  readonly manifestGovernanceStrategyHash: string;
  /** Current onchain governance state, which may advance independently. */
  readonly governanceVersion: number;
  readonly governanceStrategyHash: string;
  /** Current effective onchain visibility, independently committed by the account. */
  readonly visibility: 'private' | 'public' | 'unlisted';
  /** Current effective onchain membership admission policy. */
  readonly membershipPolicy: 'invite' | 'open' | 'request';
  readonly membershipPolicySequence: bigint;
  /** Community-wide total ordering of membership transitions. */
  readonly membershipSequence: bigint;
  readonly createdSlot: bigint;
  readonly createdAt: string;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export interface UnverifiedCommunityProjection extends CommunityProjectionBase {
  readonly manifestVerified: false;
}

export interface VerifiedCommunityProjection extends CommunityProjectionBase {
  readonly manifestVerified: true;
  readonly objectId: string;
  readonly schemaVersion: 2;
  readonly signingKeyId: string;
  readonly manifestCreatedAt: string;
  readonly content: CommunityContent;
}

export type CommunityProjection = UnverifiedCommunityProjection | VerifiedCommunityProjection;

export interface CommunityDirectoryCursor {
  readonly createdSlot: bigint;
  readonly communityAddress: string;
}

export interface CommunityDirectoryQuery {
  readonly networkId: string;
  readonly limit: number;
  readonly before?: CommunityDirectoryCursor;
}

export interface CommunityDirectorySnapshot {
  readonly checkpoint: bigint | undefined;
  readonly communities: readonly VerifiedCommunityProjection[];
  readonly next?: CommunityDirectoryCursor;
}

export interface CommunityMembershipProjection {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly membershipAddress: string;
  readonly memberIdentityId: string;
  readonly actorIdentityId: string;
  readonly authority: string;
  readonly actorSequence: bigint;
  readonly memberActionSequence: bigint;
  readonly membershipPolicySequence: bigint;
  readonly communityMembershipSequence: bigint;
  readonly activeSinceMembershipSequence: bigint;
  readonly stateSequence: bigint;
  readonly action: CommunityMembershipAction;
  readonly state: CommunityMembershipState;
  readonly manifestCid?: string;
  readonly manifestHash?: string;
  readonly manifestVerified: boolean;
  readonly objectId?: string;
  readonly signingKeyId?: string;
  readonly manifestCreatedAt?: string;
  readonly roles: number;
  readonly active: boolean;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
  readonly transactionSignature?: string;
  readonly transactionIndex?: number;
  readonly logIndex?: number;
}

export type CommunityMembershipAction = 'ban' | 'join' | 'leave' | 'remove';
export type CommunityMembershipState = 'active' | 'banned' | 'left' | 'removed';

/**
 * Privacy-safe exact-address view. Member and actor identities, signing
 * authority, and portable-manifest locations intentionally never cross this
 * projection boundary.
 */
export interface CommunityMembershipStatusProjection {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly membershipAddress: string;
  readonly action: CommunityMembershipAction;
  readonly state: CommunityMembershipState;
  readonly roles: readonly [] | readonly ['member'];
  readonly stateSequence: bigint;
  readonly memberActionSequence: bigint;
  readonly membershipPolicySequence: bigint;
  readonly communityMembershipSequence: bigint;
  readonly activeSinceMembershipSequence: bigint;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
  readonly transactionSignature: string;
  readonly transactionIndex?: number;
  readonly logIndex: number;
}

export interface CommunityMembershipStatusSnapshot {
  readonly checkpoint: bigint;
  readonly membership: CommunityMembershipStatusProjection;
}

export interface ReactionProjection {
  readonly networkId: string;
  readonly reactionReference: string;
  readonly reactorIdentityId: string;
  readonly targetPostReference: string;
  readonly authority: string;
  readonly reactionKind: number;
  readonly reactorSequence: bigint;
  readonly stateSequence: bigint;
  readonly active: boolean;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export interface RecoveryPolicyProjection {
  readonly networkId: string;
  readonly identityId: string;
  readonly recoveryPolicyAddress: string;
  readonly rootAuthority: string;
  readonly policySequence: bigint;
  readonly identitySequence: bigint;
  readonly rootRotationCount: bigint;
  readonly guardians: readonly string[];
  readonly threshold: number;
  readonly delaySlots: bigint;
  readonly active: boolean;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export type RecoveryRequestState = 'pending' | 'cancelled' | 'executed';

export interface RecoveryRequestProjection {
  readonly networkId: string;
  readonly identityId: string;
  readonly recoveryPolicyAddress: string;
  readonly recoveryRequestAddress: string;
  readonly requestNonce: string;
  readonly policySequence: bigint;
  readonly currentRootAuthority: string;
  readonly identitySequence: bigint;
  readonly rootRotationCount: bigint;
  readonly targetRootAuthority: string;
  readonly requestingGuardian: string;
  readonly guardians: readonly string[];
  readonly threshold: number;
  readonly guardianCount: number;
  readonly approvalsMask: number;
  readonly approvedGuardians: readonly string[];
  readonly approvalCount: number;
  readonly requestedSlot: bigint;
  readonly requestedAt: string;
  readonly executeAfterSlot: bigint;
  readonly state: RecoveryRequestState;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
  readonly terminalIdentitySequence?: bigint;
  readonly terminalRootRotationCount?: bigint;
  readonly terminalSlot?: bigint;
  readonly terminalAt?: string;
  readonly cancelledByRootAuthority?: string;
  readonly executor?: string;
}

export type GovernanceVoteChoice = 'yes' | 'no' | 'abstain';
export type GovernanceProposalOutcome = 'pending' | 'accepted' | 'rejected';

export interface GovernanceProposalProjection {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly proposalAddress: string;
  readonly proposerIdentityId: string;
  readonly authority: string;
  readonly proposerSequence: bigint;
  readonly previousCommunitySequence: bigint;
  readonly manifestHash: string;
  readonly manifestUri: string;
  readonly manifestVerified: false;
  readonly governanceVersion: number;
  readonly governanceStrategyHash: string;
  readonly votingModel: 'one-active-member-one-vote';
  readonly eligibleMemberCount: bigint;
  readonly communityMembershipSequence: bigint;
  readonly opensAtSlot: bigint;
  readonly closesAtSlot: bigint;
  readonly quorumBps: 5000;
  readonly approvalBps: 5001;
  readonly yesVotes: bigint;
  readonly noVotes: bigint;
  readonly abstainVotes: bigint;
  readonly stateSequence: bigint;
  readonly outcome: GovernanceProposalOutcome;
  readonly createdSlot: bigint;
  readonly createdAt: string;
  readonly finalizer?: string;
  readonly participatingVotes?: bigint;
  readonly decisiveVotes?: bigint;
  readonly quorumMet?: boolean;
  readonly approvalMet?: boolean;
  readonly finalizedSlot?: bigint;
  readonly finalizedAt?: string;
}

export interface GovernanceVoteProjection {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly proposalAddress: string;
  readonly voteAddress: string;
  readonly voterIdentityId: string;
  readonly membershipAddress: string;
  readonly authority: string;
  readonly voterSequence: bigint;
  readonly membershipStateSequence: bigint;
  readonly proposalStateSequence: bigint;
  readonly choice: GovernanceVoteChoice;
  readonly yesVotes: bigint;
  readonly noVotes: bigint;
  readonly abstainVotes: bigint;
  readonly castSlot: bigint;
  readonly castAt: string;
}

export interface PaymentEventProvenance {
  readonly transactionSignature: string;
  readonly transactionIndex?: number;
  readonly logIndex: number;
}

export interface PaymentConfigProjection extends PaymentEventProvenance {
  readonly networkId: string;
  readonly paymentConfigAddress: string;
  readonly upgradeAuthority: string;
  readonly authority: string;
  readonly feeDestination: string;
  readonly feeBps: number;
  readonly policySequence: bigint;
  readonly enabled: boolean;
  readonly initializedSlot: bigint;
  readonly initializedAt: string;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export interface PaymentRecipientSplitProjection {
  readonly recipientIdentityId: string;
  readonly destination: string;
  readonly basisPoints: number;
}

export interface SubscriptionOfferingProjection extends PaymentEventProvenance {
  readonly networkId: string;
  readonly paymentConfigAddress: string;
  readonly offeringAddress: string;
  readonly creatorIdentityId: string;
  readonly rootAuthority: string;
  readonly offeringNonce: string;
  readonly manifestHash: string;
  readonly manifestUri: string;
  readonly manifestVerified: false;
  readonly priceLamports: bigint;
  readonly billingInterval: 'week';
  readonly recipientSplits: readonly PaymentRecipientSplitProjection[];
  readonly refundPolicyHash: string;
  readonly maxProtocolFeeBps: number;
  readonly creatorRootRotationCount: bigint;
  readonly creatorSequence: bigint;
  readonly stateSequence: bigint;
  readonly active: boolean;
  readonly createdSlot: bigint;
  readonly createdAt: string;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
  readonly retiredSlot?: bigint;
  readonly retiredAt?: string;
}

export type PaymentKind = 'woke-tip' | 'weekly-subscription';

export interface PaymentReceiptProjection extends PaymentEventProvenance {
  readonly networkId: string;
  readonly receiptAddress: string;
  readonly paymentConfigAddress: string;
  readonly termsReference: string;
  readonly payerIdentityId: string;
  readonly payerAuthority: string;
  readonly subjectIdentityId: string;
  readonly primaryRecipientDestination: string;
  readonly receiptNonce: string;
  readonly paymentKind: PaymentKind;
  readonly paymentPolicySequence: bigint;
  readonly termsStateSequence: bigint;
  readonly termsManifestHash: string;
  readonly payerRootRotationCount: bigint;
  readonly grossLamports: bigint;
  readonly feeBps: number;
  readonly feeDestination: string;
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientSplits: readonly PaymentRecipientSplitProjection[];
  readonly recipientAmounts: readonly bigint[];
  readonly refundPolicyHash: string;
  readonly entitlementFromTimestamp: bigint;
  readonly entitlementUntilTimestamp: bigint;
  readonly paidAtTimestamp: bigint;
  readonly paidAtSlot: bigint;
  readonly recordedAt: string;
}

export interface SubscriptionEntitlementProjection extends PaymentEventProvenance {
  readonly networkId: string;
  readonly entitlementAddress: string;
  readonly offeringAddress: string;
  readonly beneficiaryIdentityId: string;
  readonly startedAtTimestamp: bigint;
  readonly validUntilTimestamp: bigint;
  readonly settlementCount: bigint;
  readonly lastReceiptAddress: string;
  readonly stateSequence: bigint;
  readonly lastSettledAtSlot: bigint;
  readonly refundPolicyHash: string;
  readonly recordedAt: string;
}

export interface SigningKeyAuthorizationQuery {
  readonly identityId: string;
  readonly authority: string;
  readonly kind: 'root' | 'delegation';
  readonly objectType: string;
  readonly slot: bigint;
  readonly transactionIndex?: number;
  readonly transactionSignature: string;
  readonly logIndex: number;
}

export interface ProfileProjection {
  readonly identityId: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
  readonly content: ProfileContent;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export interface PostProjection {
  readonly objectId: string;
  readonly networkId: string;
  readonly authorIdentityId: string;
  readonly cid: string;
  readonly payloadHash: string;
  readonly signingKeyId: string;
  readonly content: PostContent;
  readonly createdAt: string;
  readonly anchoredSlot: bigint;
  readonly transactionSignature: string;
  readonly verified: true;
  readonly tombstonedAt?: string;
}

export interface FollowProjection {
  readonly followerIdentityId: string;
  readonly followedIdentityId: string;
  readonly active: boolean;
  readonly updatedSlot: bigint;
  readonly updatedAt: string;
}

export interface FeedEntry {
  readonly post: PostProjection;
  readonly author: IdentityProjection;
  readonly profile?: ProfileProjection;
  readonly reason:
    | { readonly kind: 'chronological' }
    | { readonly kind: 'following'; readonly followedIdentityId: string };
}

export interface FeedQuery {
  readonly networkId: string;
  readonly viewerIdentityId?: string;
  readonly mode: 'chronological' | 'following';
  readonly limit: number;
  readonly before?: FeedCursor;
}

export interface FeedSnapshot {
  readonly checkpoint: bigint | undefined;
  readonly entries: readonly FeedEntry[];
}

export interface FeedCursor {
  readonly createdAt: string;
  readonly objectId: string;
}

export type PublicSearchMatch =
  | 'community-description'
  | 'community-name'
  | 'community-slug'
  | 'display-name'
  | 'exact-identifier'
  | 'handle'
  | 'post-body'
  | 'profile-bio';

export interface PublicSearchPersonCandidate {
  readonly kind: 'person';
  readonly identityId: string;
  readonly displayName: string;
  readonly bio: string;
  readonly handle?: string;
  readonly updatedAt: string;
}

export interface PublicSearchPostCandidate {
  readonly kind: 'post';
  readonly entry: FeedEntry;
}

export interface PublicSearchCommunityCandidate {
  readonly kind: 'community';
  readonly community: VerifiedCommunityProjection;
}

export type PublicSearchCandidate =
  PublicSearchCommunityCandidate | PublicSearchPersonCandidate | PublicSearchPostCandidate;

export type PublicSearchResult = PublicSearchCandidate & {
  readonly matchedBy: PublicSearchMatch;
};

export interface PublicSearchQuery {
  readonly networkId: string;
  readonly term: string;
  readonly limit: number;
}

export interface PublicSearchSnapshot {
  readonly checkpoint: bigint | undefined;
  readonly results: readonly PublicSearchResult[];
}
