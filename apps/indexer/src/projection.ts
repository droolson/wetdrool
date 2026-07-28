import type {
  BlockProjection,
  CommunityMembershipProjection,
  CommunityProjection,
  DelegationProjection,
  FeedEntry,
  FeedQuery,
  GovernanceProposalProjection,
  GovernanceVoteProjection,
  HandleProjection,
  IdentityProjection,
  PaymentConfigProjection,
  PaymentReceiptProjection,
  PostProjection,
  ProfileProjection,
  ProtocolConfigProjection,
  PublicSearchQuery,
  PublicSearchSnapshot,
  ReactionProjection,
  RecoveryPolicyProjection,
  RecoveryRequestProjection,
  SigningKeyAuthorizationQuery,
  SubscriptionEntitlementProjection,
  SubscriptionOfferingProjection,
} from './models.js';
import type { ProtocolEvent } from './events.js';

export interface VerifiedManifest {
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
  readonly signingKeyId: string;
  readonly authorIdentityId: string;
  readonly createdAt: string;
  readonly type: 'profile' | 'post' | 'tombstone';
  readonly content: unknown;
}

export interface ProjectionStore {
  apply(event: ProtocolEvent, manifest?: VerifiedManifest): Promise<boolean>;
  rebuildProjection(networkId: string, items: readonly ProjectionReplayItem[]): Promise<void>;
  advanceCheckpoint(
    networkId: string,
    finalizedSlot: bigint,
    transactionSignature: string,
    logIndex: number,
  ): Promise<void>;
  getPost(objectId: string): Promise<PostProjection | undefined>;
  findPostObjectIdByReference(
    networkId: string,
    onchainReference: string,
  ): Promise<string | undefined>;
  getProfile(identityId: string): Promise<ProfileProjection | undefined>;
  getIdentity(identityId: string): Promise<IdentityProjection | undefined>;
  getProtocolConfig(networkId: string): Promise<ProtocolConfigProjection | undefined>;
  getHandle(networkId: string, handle: string): Promise<HandleProjection | undefined>;
  getHandlesByIdentity(identityId: string): Promise<readonly HandleProjection[]>;
  getDelegations(identityId: string): Promise<readonly DelegationProjection[]>;
  authorizeSigningKey(query: SigningKeyAuthorizationQuery): Promise<boolean>;
  getBlock(
    blockerIdentityId: string,
    subjectIdentityId: string,
  ): Promise<BlockProjection | undefined>;
  getCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<CommunityProjection | undefined>;
  getCommunityMemberships(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly CommunityMembershipProjection[]>;
  getReactionsByPostReference(
    networkId: string,
    targetPostReference: string,
  ): Promise<readonly ReactionProjection[]>;
  getRecoveryPolicy(identityId: string): Promise<RecoveryPolicyProjection | undefined>;
  getRecoveryRequest(
    networkId: string,
    recoveryRequestAddress: string,
  ): Promise<RecoveryRequestProjection | undefined>;
  getRecoveryRequestsByIdentity(identityId: string): Promise<readonly RecoveryRequestProjection[]>;
  getGovernanceProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<GovernanceProposalProjection | undefined>;
  getGovernanceProposalsByCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly GovernanceProposalProjection[]>;
  getGovernanceVote(
    networkId: string,
    voteAddress: string,
  ): Promise<GovernanceVoteProjection | undefined>;
  getGovernanceVotesByProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<readonly GovernanceVoteProjection[]>;
  getPaymentConfig(networkId: string): Promise<PaymentConfigProjection | undefined>;
  getSubscriptionOffering(
    networkId: string,
    offeringAddress: string,
  ): Promise<SubscriptionOfferingProjection | undefined>;
  getSubscriptionOfferingsByCreator(
    networkId: string,
    creatorIdentityId: string,
  ): Promise<readonly SubscriptionOfferingProjection[]>;
  getPaymentReceipt(
    networkId: string,
    receiptAddress: string,
  ): Promise<PaymentReceiptProjection | undefined>;
  getSubscriptionEntitlement(
    networkId: string,
    entitlementAddress: string,
  ): Promise<SubscriptionEntitlementProjection | undefined>;
  searchPublic(query: PublicSearchQuery): Promise<PublicSearchSnapshot>;
  getFeed(query: FeedQuery): Promise<readonly FeedEntry[]>;
  clearProjection(networkId: string): Promise<void>;
  checkpoint(networkId: string): Promise<bigint | undefined>;
  close(): Promise<void>;
}

export interface ProjectionReplayItem {
  readonly event: ProtocolEvent;
  readonly manifest?: VerifiedManifest;
}

export interface DeadLetterRecord {
  readonly attempts: number;
  readonly nextAttemptAt?: string;
}

export interface DeadLetterInput {
  readonly networkId: string;
  readonly transactionSignature: string;
  readonly logIndex: number;
  readonly eventBody: Readonly<Record<string, unknown>>;
  readonly failureCode: string;
  readonly failureDetail: string;
  readonly nextAttemptAt?: string;
}

export interface IngestionStateStore {
  deadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<DeadLetterRecord | undefined>;
  recordDeadLetter(input: DeadLetterInput): Promise<DeadLetterRecord>;
  resolveDeadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<void>;
}

export class ProjectionError extends Error {
  override readonly name = 'ProjectionError';

  constructor(
    message: string,
    readonly code:
      | 'manifest-required'
      | 'manifest-mismatch'
      | 'missing-identity'
      | 'stale-event'
      | 'event-conflict'
      | 'search-capacity'
      | 'search-timeout'
      | 'database-error',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
