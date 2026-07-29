import type {
  BlockProjection,
  CommunityDirectoryQuery,
  CommunityDirectorySnapshot,
  CommunityMembershipProjection,
  CommunityProjection,
  DelegationProjection,
  FeedEntry,
  FeedQuery,
  FeedSnapshot,
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
import { compareEventOrder, type ProtocolEvent } from './events.js';

export interface VerifiedManifest {
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: string;
  readonly schemaVersion: 1 | 2;
  readonly signingKeyId: string;
  readonly authorIdentityId: string;
  readonly createdAt: string;
  readonly type: 'profile' | 'post' | 'community' | 'tombstone';
  readonly content: unknown;
}

export interface ProjectionStore {
  readiness?(): Promise<void>;
  apply(event: ProtocolEvent, manifest?: VerifiedManifest): Promise<boolean>;
  manifestEventDisposition(event: ProtocolEvent): Promise<ManifestEventDisposition | undefined>;
  duePendingManifestEvents(
    networkId: string,
    dueAt: string,
    limit: number,
  ): Promise<readonly PendingManifestRecord[]>;
  deferManifestEvent(event: ProtocolEvent, deferral: ManifestDeferral): Promise<boolean>;
  reschedulePendingManifestEvent(
    event: ProtocolEvent,
    deferral: ManifestDeferral,
  ): Promise<DeadLetterRecord | undefined>;
  promoteManifestEvent(event: ProtocolEvent, manifest: VerifiedManifest): Promise<boolean>;
  rejectPendingManifestEvent(
    event: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean>;
  quarantineManifestEvent(
    event: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean>;
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
  listPublicCommunities(query: CommunityDirectoryQuery): Promise<CommunityDirectorySnapshot>;
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
  getFeedSnapshot(query: FeedQuery): Promise<FeedSnapshot>;
  clearProjection(networkId: string): Promise<void>;
  checkpoint(networkId: string): Promise<bigint | undefined>;
  close(): Promise<void>;
}

export interface ProjectionReplayItem {
  readonly event: ProtocolEvent;
  readonly manifest?: VerifiedManifest;
  readonly acceptedManifestSuppression?: AcceptedManifestSuppression;
  readonly pendingManifest?: ManifestDeferral;
  readonly terminalFailureCode?: TerminalManifestFailureCode;
}

export interface AcceptedManifestSuppression {
  readonly reason: 'later-profile-pointer' | 'later-tombstone';
  readonly suppressorTransactionSignature: string;
  readonly suppressorLogIndex: number;
}

export function replayEventCoordinateKey(event: {
  readonly networkId: string;
  readonly transactionSignature: string;
  readonly logIndex: number;
}): string {
  return `${event.networkId}\u0000${event.transactionSignature}\u0000${String(event.logIndex)}`;
}

export function deriveAcceptedManifestSuppressions(
  events: readonly ProtocolEvent[],
  isDurablyAccepted: (event: ProtocolEvent) => boolean,
): ReadonlyMap<string, AcceptedManifestSuppression> {
  const ordered = [...events].sort(compareEventOrder);
  const suppressions = new Map<string, AcceptedManifestSuppression>();
  const laterProfilePointers = new Map<string, ProtocolEvent>();
  const laterTombstones = new Map<string, ProtocolEvent>();

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const event = ordered[index];
    if (event === undefined) continue;

    if (isDurablyAccepted(event)) {
      const suppressor =
        event.type === 'profile-updated'
          ? laterProfilePointers.get(event.identityId)
          : event.type === 'post-published'
            ? laterTombstones.get(postSuppressionKey(event))
            : undefined;
      if (suppressor !== undefined) {
        suppressions.set(replayEventCoordinateKey(event), {
          reason: event.type === 'profile-updated' ? 'later-profile-pointer' : 'later-tombstone',
          suppressorTransactionSignature: suppressor.transactionSignature,
          suppressorLogIndex: suppressor.logIndex,
        });
      }
    }

    if (event.type === 'profile-updated') {
      laterProfilePointers.set(event.identityId, event);
    } else if (event.type === 'tombstoned') {
      laterTombstones.set(postSuppressionKey(event), event);
    }
  }

  return suppressions;
}

export function assertCanonicalAcceptedManifestSuppressions(
  items: readonly ProjectionReplayItem[],
): void {
  const suppressedKeys = new Set(
    items
      .filter(({ acceptedManifestSuppression }) => acceptedManifestSuppression !== undefined)
      .map(({ event }) => replayEventCoordinateKey(event)),
  );
  if (suppressedKeys.size === 0) return;

  const expected = deriveAcceptedManifestSuppressions(
    items.map(({ event }) => event),
    (event) => suppressedKeys.has(replayEventCoordinateKey(event)),
  );
  for (const item of items) {
    const suppression = item.acceptedManifestSuppression;
    if (suppression === undefined) continue;
    const canonical = expected.get(replayEventCoordinateKey(item.event));
    if (
      item.manifest !== undefined ||
      item.pendingManifest !== undefined ||
      item.terminalFailureCode !== undefined ||
      canonical === undefined ||
      canonical.reason !== suppression.reason ||
      canonical.suppressorTransactionSignature !== suppression.suppressorTransactionSignature ||
      canonical.suppressorLogIndex !== suppression.suppressorLogIndex
    ) {
      throw new ProjectionError(
        'Accepted manifest suppression is not justified by the complete immutable event order.',
        'event-conflict',
      );
    }
  }
}

function postSuppressionKey(
  event:
    | Extract<ProtocolEvent, { readonly type: 'post-published' }>
    | Extract<ProtocolEvent, { readonly type: 'tombstoned' }>,
): string {
  const objectId = event.type === 'post-published' ? event.objectId : event.targetObjectId;
  return `${event.networkId}\u0000${event.identityId}\u0000${objectId}`;
}

export type ManifestEventDisposition =
  | { readonly state: 'accepted' }
  | { readonly state: 'pending' }
  | {
      readonly state: 'terminal';
      readonly failureCode: TerminalManifestFailureCode;
    };

export interface ManifestDeferral {
  readonly eventBody: Readonly<Record<string, unknown>>;
  readonly failureCode: 'manifest-unavailable';
  readonly failureDetail: string;
  readonly nextAttemptAt: string;
}

export interface PendingManifestRecord {
  readonly event: ProtocolEvent;
  readonly attempts: number;
  readonly eventBody: Readonly<Record<string, unknown>>;
  readonly failureDetail: string;
  readonly nextAttemptAt: string;
}

export interface DeadLetterRecord {
  readonly attempts: number;
  readonly nextAttemptAt?: string;
  readonly terminalFailureCode?: TerminalManifestFailureCode;
}

export type TerminalManifestFailureCode =
  | 'author-mismatch'
  | 'cid-mismatch'
  | 'hash-mismatch'
  | 'manifest-invalid'
  | 'manifest-uri'
  | 'object-mismatch'
  | 'schema-version'
  | 'type-mismatch'
  | 'unauthorized-key'
  | 'unsupported-event';

export interface TerminalManifestRejection {
  readonly eventBody: Readonly<Record<string, unknown>>;
  readonly failureCode: TerminalManifestFailureCode;
  readonly failureDetail: string;
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
