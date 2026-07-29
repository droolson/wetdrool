import {
  assertUnambiguousEventOrder,
  compareEventOrder,
  protocolEventSchema,
  type ProtocolEvent,
} from './events.js';
import {
  deriveCommunityMembershipAddress,
  deriveGovernanceProposalAddress,
  deriveGovernanceVoteAddress,
} from './governance-addresses.js';
import {
  derivePaymentConfigAddress,
  derivePaymentReceiptAddress,
  deriveSubscriptionEntitlementAddress,
  deriveSubscriptionOfferingAddress,
} from './payment-addresses.js';
import {
  calculatePaymentAllocation,
  calculateSubscriptionWindow,
  PaymentInvariantError,
} from './payment-validation.js';
import { deriveRecoveryPolicyAddress, deriveRecoveryRequestAddress } from './recovery-addresses.js';
import type {
  BlockProjection,
  CommunityDirectoryQuery,
  CommunityDirectorySnapshot,
  CommunityMembershipProjection,
  CommunityProjection,
  VerifiedCommunityProjection,
  DelegationProjection,
  FeedEntry,
  FeedQuery,
  FeedSnapshot,
  FollowProjection,
  GovernanceProposalProjection,
  GovernanceVoteProjection,
  HandleProjection,
  IdentityProjection,
  PaymentConfigProjection,
  PaymentReceiptProjection,
  PaymentRecipientSplitProjection,
  PostProjection,
  ProfileProjection,
  ProtocolConfigProjection,
  PublicSearchCandidate,
  PublicSearchQuery,
  PublicSearchSnapshot,
  ReactionProjection,
  RecoveryPolicyProjection,
  RecoveryRequestProjection,
  SigningKeyAuthorizationQuery,
  SubscriptionEntitlementProjection,
  SubscriptionOfferingProjection,
} from './models.js';
import { projectPublicProfileContent } from './profile-privacy.js';
import {
  assertCanonicalAcceptedManifestSuppressions,
  ProjectionError,
  type DeadLetterInput,
  type DeadLetterRecord,
  type IngestionStateStore,
  type ManifestDeferral,
  type ManifestEventDisposition,
  type PendingManifestRecord,
  type ProjectionReplayItem,
  type ProjectionStore,
  type TerminalManifestFailureCode,
  type TerminalManifestRejection,
  type VerifiedManifest,
} from './projection.js';
import {
  comparePublicSearchText,
  isValidPublicSearchTerm,
  normalizePublicSearchTerm,
  rankPublicSearchCandidates,
} from './public-search.js';

interface EventPosition {
  readonly slot: bigint;
  readonly transactionIndex: number | undefined;
  readonly transactionSignature: string;
  readonly logIndex: number;
}

interface RootHistory {
  readonly identityId: string;
  readonly programId: string;
  readonly authority: string;
  readonly rotationCount: bigint;
  readonly identitySequence: bigint;
  readonly position: EventPosition;
}

interface StoredDelegation extends DelegationProjection {
  readonly createdPosition: EventPosition;
  readonly revokedPosition?: EventPosition;
}

interface StoredHandle extends HandleProjection {
  readonly active: boolean;
  readonly releasedSlot?: bigint;
  readonly releasedAt?: string;
}

interface NetworkMutexState {
  readonly waiters: (() => void)[];
}

const ZERO_DIGEST = 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class MemoryProjectionStore implements ProjectionStore, IngestionStateStore {
  readonly #events = new Map<string, ProtocolEvent>();
  readonly #configs = new Map<string, ProtocolConfigProjection>();
  readonly #identities = new Map<string, IdentityProjection>();
  readonly #identitySequencePositions = new Map<string, EventPosition>();
  readonly #deactivationPositions = new Map<string, EventPosition>();
  readonly #handlesByAddress = new Map<string, StoredHandle>();
  readonly #handleAddressesByName = new Map<string, string>();
  readonly #rootHistory = new Map<string, RootHistory[]>();
  readonly #delegations = new Map<string, StoredDelegation>();
  readonly #profiles = new Map<string, ProfileProjection>();
  readonly #posts = new Map<string, PostProjection>();
  readonly #postReferences = new Map<string, string>();
  readonly #follows = new Map<string, FollowProjection & { readonly sequence: bigint }>();
  readonly #blocks = new Map<string, BlockProjection>();
  readonly #communities = new Map<string, CommunityProjection>();
  readonly #memberships = new Map<string, CommunityMembershipProjection>();
  readonly #reactions = new Map<string, ReactionProjection>();
  readonly #recoveryPolicies = new Map<string, RecoveryPolicyProjection>();
  readonly #recoveryRequests = new Map<string, RecoveryRequestProjection>();
  readonly #governanceProposals = new Map<string, GovernanceProposalProjection>();
  readonly #proposalByCommunityManifest = new Map<string, string>();
  readonly #governanceVotes = new Map<string, GovernanceVoteProjection>();
  readonly #voteByProposalVoter = new Map<string, string>();
  readonly #lastGovernanceVoterSequence = new Map<string, bigint>();
  readonly #paymentConfigs = new Map<string, PaymentConfigProjection>();
  readonly #subscriptionOfferings = new Map<string, SubscriptionOfferingProjection>();
  readonly #paymentReceipts = new Map<string, PaymentReceiptProjection>();
  readonly #subscriptionEntitlements = new Map<string, SubscriptionEntitlementProjection>();
  readonly #checkpoints = new Map<string, bigint>();
  readonly #deadLetters = new Map<string, DeadLetterRecord>();
  readonly #pendingManifestEvents = new Set<string>();
  readonly #pendingManifestDeferrals = new Map<string, ManifestDeferral>();
  readonly #terminalManifestFailures = new Map<string, TerminalManifestFailureCode>();
  readonly #latestProfileManifestEvents = new Map<string, string>();
  readonly #networkMutexes = new Map<string, NetworkMutexState>();

  async apply(event: ProtocolEvent, manifest?: VerifiedManifest): Promise<boolean> {
    return this.#withNetworkLock(event.networkId, () => this.#applyUnlocked(event, manifest));
  }

  async manifestEventDisposition(
    input: ProtocolEvent,
  ): Promise<ManifestEventDisposition | undefined> {
    const event = protocolEventSchema.parse(input);
    return this.#withNetworkLock<ManifestEventDisposition | undefined>(event.networkId, () => {
      const eventKey = keyForEvent(event);
      const existingEvent = this.#events.get(eventKey);
      if (existingEvent === undefined) return Promise.resolve(undefined);
      if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      const terminalFailureCode = this.#terminalManifestFailures.get(eventKey);
      if (terminalFailureCode !== undefined) {
        return Promise.resolve({
          state: 'terminal' as const,
          failureCode: terminalFailureCode,
        });
      }
      return Promise.resolve({
        state: this.#pendingManifestEvents.has(eventKey)
          ? ('pending' as const)
          : ('accepted' as const),
      });
    });
  }

  async duePendingManifestEvents(
    networkId: string,
    dueAt: string,
    limit: number,
  ): Promise<readonly PendingManifestRecord[]> {
    const dueTimestamp = pendingManifestDueTimestamp(dueAt);
    assertPendingManifestLimit(limit);
    return this.#withNetworkLock(networkId, () => {
      const records: PendingManifestRecord[] = [];
      for (const eventKey of this.#pendingManifestEvents) {
        const event = this.#events.get(eventKey);
        if (event?.networkId !== networkId) continue;
        const deferral = this.#pendingManifestDeferrals.get(eventKey);
        const deadLetter = this.#deadLetters.get(
          deadLetterKey(event.networkId, event.transactionSignature, event.logIndex),
        );
        if (
          deferral === undefined ||
          deadLetter?.nextAttemptAt === undefined ||
          deadLetter.terminalFailureCode !== undefined ||
          deadLetter.nextAttemptAt !== deferral.nextAttemptAt ||
          !Number.isSafeInteger(deadLetter.attempts) ||
          deadLetter.attempts <= 0
        ) {
          throw new ProjectionError(
            'Pending manifest state is missing its exact retry metadata.',
            'database-error',
          );
        }
        if (pendingManifestDueTimestamp(deferral.nextAttemptAt) > dueTimestamp) continue;
        records.push({
          event: protocolEventSchema.parse(event),
          attempts: deadLetter.attempts,
          eventBody: structuredClone(deferral.eventBody),
          failureDetail: deferral.failureDetail,
          nextAttemptAt: deferral.nextAttemptAt,
        });
      }
      records.sort((left, right) => {
        const dueOrder = left.nextAttemptAt.localeCompare(right.nextAttemptAt);
        return dueOrder === 0 ? compareEventOrder(left.event, right.event) : dueOrder;
      });
      return Promise.resolve(records.slice(0, limit));
    });
  }

  async deferManifestEvent(input: ProtocolEvent, deferral: ManifestDeferral): Promise<boolean> {
    const event = protocolEventSchema.parse(input);
    return this.#withNetworkLock(event.networkId, () =>
      this.#deferManifestEventUnlocked(event, deferral),
    );
  }

  async #deferManifestEventUnlocked(
    event: ProtocolEvent,
    deferral: ManifestDeferral,
  ): Promise<boolean> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'community-created'
    ) {
      throw new ProjectionError(
        'Only profile, post, and community manifest events can be deferred.',
        'manifest-mismatch',
      );
    }
    if (deferral.failureCode !== 'manifest-unavailable') {
      throw new ProjectionError(
        'Only a manifest-unavailable failure can be deferred.',
        'manifest-mismatch',
      );
    }
    const normalizedDeferral = normalizedManifestDeferral(deferral);

    const eventKey = keyForEvent(event);
    const existingEvent = this.#events.get(eventKey);
    if (existingEvent !== undefined) {
      if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      if (
        this.#pendingManifestEvents.has(eventKey) &&
        !this.#terminalManifestFailures.has(eventKey)
      ) {
        return false;
      }
      throw eventConflict();
    }

    const operationalKey = deadLetterKey(
      event.networkId,
      event.transactionSignature,
      event.logIndex,
    );
    if (this.#deadLetters.get(operationalKey)?.terminalFailureCode !== undefined) {
      throw eventConflict();
    }

    const position = positionFor(event);
    const sequenceAdvance = this.#validateIdentityLifecycle(event, position);
    if (sequenceAdvance === undefined) {
      throw stale('A deferred manifest event must advance one identity sequence.');
    }
    const identity = this.#requireIdentity(sequenceAdvance.identityId);

    if (event.type === 'profile-updated') {
      // A finalized new pointer supersedes the currently served profile even
      // while its off-chain bytes are temporarily unavailable.
      this.#profiles.delete(event.identityId);
      this.#latestProfileManifestEvents.set(event.identityId, eventKey);
    } else if (event.type === 'post-published' && event.postReference !== undefined) {
      // Preserve the on-chain reference so later lifecycle events can resolve
      // it without exposing unverified post content.
      this.#postReferences.set(
        postReferenceKey(event.networkId, event.postReference),
        event.objectId,
      );
    } else if (event.type === 'community-created') {
      const key = communityKey(event.networkId, event.communityAddress);
      if (this.#communities.has(key)) {
        throw stale('Community address was already projected.');
      }
      this.#communities.set(key, unverifiedCommunityProjection(event));
    }

    this.#identities.set(sequenceAdvance.identityId, {
      ...identity,
      identitySequence: sequenceAdvance.sequence,
      updatedSlot: event.slot,
      updatedAt: event.blockTime,
    });
    this.#identitySequencePositions.set(sequenceAdvance.identityId, position);
    this.#events.set(eventKey, event);
    this.#pendingManifestEvents.add(eventKey);
    this.#pendingManifestDeferrals.set(eventKey, normalizedDeferral);
    const currentCheckpoint = this.#checkpoints.get(event.networkId) ?? -1n;
    if (event.slot > currentCheckpoint) {
      this.#checkpoints.set(event.networkId, event.slot);
    }
    const previous = this.#deadLetters.get(operationalKey);
    this.#deadLetters.set(operationalKey, {
      attempts: (previous?.attempts ?? 0) + 1,
      nextAttemptAt: normalizedDeferral.nextAttemptAt,
    });
    return true;
  }

  async reschedulePendingManifestEvent(
    input: ProtocolEvent,
    deferral: ManifestDeferral,
  ): Promise<DeadLetterRecord | undefined> {
    const event = protocolEventSchema.parse(input);
    const normalizedDeferral = normalizedManifestDeferral(deferral);
    return this.#withNetworkLock(event.networkId, () => {
      const eventKey = keyForEvent(event);
      const existingEvent = this.#events.get(eventKey);
      if (existingEvent === undefined) {
        throw stale('A manifest event must be durably pending before it can be rescheduled.');
      }
      if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      if (
        this.#terminalManifestFailures.has(eventKey) ||
        !this.#pendingManifestEvents.has(eventKey)
      ) {
        return Promise.resolve(undefined);
      }
      const operationalKey = deadLetterKey(
        event.networkId,
        event.transactionSignature,
        event.logIndex,
      );
      const previous = this.#deadLetters.get(operationalKey);
      if (
        previous?.nextAttemptAt === undefined ||
        previous.terminalFailureCode !== undefined ||
        !Number.isSafeInteger(previous.attempts) ||
        previous.attempts <= 0
      ) {
        throw new ProjectionError(
          'Pending manifest state is missing its retryable dead letter.',
          'database-error',
        );
      }
      const record: DeadLetterRecord = {
        attempts: previous.attempts + 1,
        nextAttemptAt: normalizedDeferral.nextAttemptAt,
      };
      this.#deadLetters.set(operationalKey, record);
      this.#pendingManifestDeferrals.set(eventKey, normalizedDeferral);
      return Promise.resolve(record);
    });
  }

  async promoteManifestEvent(input: ProtocolEvent, manifest: VerifiedManifest): Promise<boolean> {
    const event = protocolEventSchema.parse(input);
    return this.#withNetworkLock(event.networkId, () =>
      this.#promoteManifestEventUnlocked(event, manifest),
    );
  }

  async #promoteManifestEventUnlocked(
    event: ProtocolEvent,
    manifest: VerifiedManifest,
  ): Promise<boolean> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'community-created'
    ) {
      throw new ProjectionError(
        'Only profile, post, and community manifest events can be promoted.',
        'manifest-mismatch',
      );
    }
    const eventKey = keyForEvent(event);
    const existingEvent = this.#events.get(eventKey);
    if (existingEvent === undefined) {
      throw stale('A manifest event must be durably pending before it can be promoted.');
    }
    if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
      throw eventConflict();
    }
    if (this.#terminalManifestFailures.has(eventKey)) {
      throw eventConflict();
    }
    if (!this.#pendingManifestEvents.has(eventKey)) {
      return false;
    }

    if (event.type === 'profile-updated') {
      const verified = requireManifest(event, manifest, 'profile');
      const content = projectPublicProfileContent(verified.schemaVersion, verified.content);
      this.#requireIdentity(event.identityId);
      // Deactivation disables future mutations and public discovery; it is not
      // retroactive erasure. Match PostgreSQL by retaining late-arriving bytes
      // for the last finalized pre-deactivation profile pointer.
      if (this.#latestProfileManifestEvents.get(event.identityId) === eventKey) {
        this.#profiles.set(event.identityId, {
          identityId: event.identityId,
          objectId: verified.objectId,
          cid: verified.cid,
          payloadHash: verified.payloadHash,
          content,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
      }
    } else if (event.type === 'post-published') {
      const verified = requireManifest(event, manifest, 'post');
      const tombstonedAt = this.#laterTombstoneAt(event);
      this.#posts.set(verified.objectId, {
        objectId: verified.objectId,
        networkId: event.networkId,
        authorIdentityId: event.identityId,
        cid: verified.cid,
        payloadHash: verified.payloadHash,
        signingKeyId: verified.signingKeyId,
        content: verified.content as PostProjection['content'],
        createdAt: event.blockTime,
        anchoredSlot: event.slot,
        transactionSignature: event.transactionSignature,
        verified: true,
        ...(tombstonedAt === undefined ? {} : { tombstonedAt }),
      });
    } else {
      const verified = requireManifest(event, manifest, 'community');
      const key = communityKey(event.networkId, event.communityAddress);
      const community = this.#communities.get(key);
      if (community === undefined) {
        throw stale('A pending community shell must exist before manifest promotion.');
      }
      this.#communities.set(key, {
        ...community,
        manifestVerified: true,
        objectId: verified.objectId,
        schemaVersion: 2,
        signingKeyId: verified.signingKeyId,
        manifestCreatedAt: verified.createdAt,
        content: verified.content as Extract<
          CommunityProjection,
          { readonly manifestVerified: true }
        >['content'],
      });
    }

    this.#pendingManifestEvents.delete(eventKey);
    this.#pendingManifestDeferrals.delete(eventKey);
    const operationalKey = deadLetterKey(
      event.networkId,
      event.transactionSignature,
      event.logIndex,
    );
    if (this.#deadLetters.get(operationalKey)?.terminalFailureCode === undefined) {
      this.#deadLetters.delete(operationalKey);
    }
    return true;
  }

  async rejectPendingManifestEvent(
    input: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean> {
    const event = protocolEventSchema.parse(input);
    return this.#withNetworkLock(event.networkId, () =>
      this.#rejectPendingManifestEventUnlocked(event, rejection),
    );
  }

  async #rejectPendingManifestEventUnlocked(
    event: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'community-created'
    ) {
      throw new ProjectionError(
        'Only profile, post, and community manifest events can transition from pending to terminal.',
        'manifest-mismatch',
      );
    }
    const eventKey = keyForEvent(event);
    const existingEvent = this.#events.get(eventKey);
    if (existingEvent === undefined) {
      throw stale('A manifest event must be durably pending before it can be rejected.');
    }
    if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
      throw eventConflict();
    }
    const existingTerminalCode = this.#terminalManifestFailures.get(eventKey);
    if (existingTerminalCode !== undefined) {
      if (existingTerminalCode !== rejection.failureCode) throw eventConflict();
      return false;
    }
    if (!this.#pendingManifestEvents.has(eventKey)) {
      throw eventConflict();
    }

    this.#pendingManifestEvents.delete(eventKey);
    this.#pendingManifestDeferrals.delete(eventKey);
    this.#terminalManifestFailures.set(eventKey, rejection.failureCode);
    const operationalKey = deadLetterKey(
      event.networkId,
      event.transactionSignature,
      event.logIndex,
    );
    const previous = this.#deadLetters.get(operationalKey);
    this.#deadLetters.set(operationalKey, {
      attempts: previous?.attempts ?? 1,
      terminalFailureCode: rejection.failureCode,
    });
    return true;
  }

  async quarantineManifestEvent(
    input: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean> {
    const event = protocolEventSchema.parse(input);
    return this.#withNetworkLock(event.networkId, () =>
      this.#quarantineManifestEventUnlocked(event, rejection),
    );
  }

  async #quarantineManifestEventUnlocked(
    event: ProtocolEvent,
    rejection: TerminalManifestRejection,
  ): Promise<boolean> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'community-created' &&
      event.type !== 'tombstoned'
    ) {
      throw new ProjectionError(
        'Only manifest-bearing protocol events can be terminally quarantined.',
        'manifest-mismatch',
      );
    }

    const eventKey = keyForEvent(event);
    const existingEvent = this.#events.get(eventKey);
    const deadLetterKeyValue = deadLetterKey(
      event.networkId,
      event.transactionSignature,
      event.logIndex,
    );
    if (existingEvent !== undefined) {
      if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      if (this.#terminalManifestFailures.get(eventKey) !== rejection.failureCode) {
        throw eventConflict();
      }
      return false;
    }

    const position = positionFor(event);
    const sequenceAdvance = this.#validateIdentityLifecycle(event, position);
    if (sequenceAdvance === undefined) {
      throw stale('A quarantined manifest event must advance one identity sequence.');
    }

    if (event.type === 'profile-updated') {
      // The finalized chain pointer is now invalid. Do not continue serving the
      // superseded profile as though it were the identity's current profile.
      this.#profiles.delete(event.identityId);
      this.#latestProfileManifestEvents.set(event.identityId, eventKey);
    } else if (event.type === 'post-published' && event.postReference !== undefined) {
      // Raw references remain resolvable for later on-chain lifecycle events,
      // but no public post projection is created.
      this.#postReferences.set(
        postReferenceKey(event.networkId, event.postReference),
        event.objectId,
      );
    } else if (event.type === 'tombstoned') {
      const post = this.#posts.get(event.targetObjectId);
      if (post?.authorIdentityId === event.identityId) {
        this.#posts.set(post.objectId, {
          ...post,
          tombstonedAt: event.blockTime,
        });
      }
    } else if (event.type === 'community-created') {
      const key = communityKey(event.networkId, event.communityAddress);
      if (this.#communities.has(key)) {
        throw stale('Community address was already projected.');
      }
      this.#communities.set(key, unverifiedCommunityProjection(event));
    }

    const identity = this.#requireIdentity(sequenceAdvance.identityId);
    this.#identities.set(sequenceAdvance.identityId, {
      ...identity,
      identitySequence: sequenceAdvance.sequence,
      updatedSlot: event.slot,
      updatedAt: event.blockTime,
    });
    this.#identitySequencePositions.set(sequenceAdvance.identityId, position);
    this.#events.set(eventKey, event);
    this.#terminalManifestFailures.set(eventKey, rejection.failureCode);
    const currentCheckpoint = this.#checkpoints.get(event.networkId) ?? -1n;
    if (event.slot > currentCheckpoint) {
      this.#checkpoints.set(event.networkId, event.slot);
    }
    const previous = this.#deadLetters.get(deadLetterKeyValue);
    this.#deadLetters.set(deadLetterKeyValue, {
      attempts: (previous?.attempts ?? 0) + 1,
      terminalFailureCode: rejection.failureCode,
    });
    return true;
  }

  async #applyUnlocked(event: ProtocolEvent, manifest?: VerifiedManifest): Promise<boolean> {
    const eventKey = keyForEvent(event);
    const existingEvent = this.#events.get(eventKey);
    if (existingEvent !== undefined) {
      if (eventFingerprint(existingEvent) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      if (
        this.#pendingManifestEvents.has(eventKey) ||
        this.#terminalManifestFailures.has(eventKey)
      ) {
        throw eventConflict();
      }
      return false;
    }
    const position = positionFor(event);
    const sequenceAdvance = this.#validateIdentityLifecycle(event, position);

    switch (event.type) {
      case 'protocol-initialized':
        this.#configs.set(event.networkId, {
          networkId: event.networkId,
          configAddress: event.configAddress,
          initializedSlot: event.slot,
          initializedAt: event.blockTime,
        });
        break;
      case 'identity-created': {
        const identity: IdentityProjection = {
          identityId: event.identityId,
          networkId: event.networkId,
          identityAddress: event.identityAddress,
          rootAuthority: event.rootAuthority,
          rootRotationCount: 0n,
          active: true,
          identitySequence: 0n,
          createdSlot: event.slot,
          createdAt: event.blockTime,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        };
        this.#identities.set(event.identityId, identity);
        this.#identitySequencePositions.set(event.identityId, position);
        this.#rootHistory.set(event.identityId, [
          {
            identityId: event.identityId,
            programId: event.programId,
            authority: event.rootAuthority,
            rotationCount: 0n,
            identitySequence: 0n,
            position,
          },
        ]);
        break;
      }
      case 'identity-deactivated': {
        const config = this.#configs.get(event.networkId);
        const identity = this.#requireIdentity(event.identityId);
        const currentPosition = this.#identitySequencePositions.get(event.identityId);
        if (
          config === undefined ||
          config.configAddress !== event.configAddress ||
          identity.networkId !== event.networkId ||
          identity.identityAddress !== event.identityAddress ||
          identity.rootAuthority !== event.rootAuthority ||
          event.identitySequence !== identity.identitySequence + 1n ||
          currentPosition === undefined ||
          comparePosition(position, currentPosition) <= 0
        ) {
          throw stale(
            'Identity deactivation does not exactly advance the indexed identity and protocol.',
          );
        }
        if (!identity.active) {
          throw stale('Identity is already inactive.');
        }
        this.#identities.set(event.identityId, {
          ...identity,
          active: false,
          identitySequence: event.identitySequence,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          deactivatedSlot: event.slot,
          deactivatedAt: event.blockTime,
        });
        this.#identitySequencePositions.set(event.identityId, position);
        this.#deactivationPositions.set(event.identityId, position);
        break;
      }
      case 'handle-claimed': {
        const identity = this.#requireHandleAuthority(
          event.networkId,
          event.identityId,
          event.authority,
        );
        const addressKey = handleAddressKey(event.networkId, event.handleClaimAddress);
        const nameKey = handleNameKey(event.networkId, event.handle);
        const byAddress = this.#handlesByAddress.get(addressKey);
        const indexedAddress = this.#handleAddressesByName.get(nameKey);
        const byName =
          indexedAddress === undefined ? undefined : this.#handlesByAddress.get(indexedAddress);
        if (byAddress !== undefined && byName !== undefined && byAddress !== byName) {
          throw stale('Handle name and claim address resolve to conflicting projections.');
        }
        const current = byAddress ?? byName;
        if (current?.active === true) {
          throw stale('Handle name or claim address is already active.');
        }
        if (
          current !== undefined &&
          (current.networkId !== event.networkId ||
            current.handleClaimAddress !== event.handleClaimAddress ||
            current.handle !== event.handle ||
            current.handleHash !== event.handleHash)
        ) {
          throw stale('Handle reclaim does not match the released claim address and digest.');
        }
        if (
          current !== undefined &&
          ((current.releasedSlot !== undefined && event.slot < current.releasedSlot) ||
            (current.identityId === event.identityId &&
              event.identitySequence <= current.identitySequence))
        ) {
          throw stale('Handle reclaim does not advance the released claim state.');
        }
        const handle: StoredHandle = {
          networkId: event.networkId,
          handleClaimAddress: event.handleClaimAddress,
          identityId: identity.identityId,
          authority: event.authority,
          identitySequence: event.identitySequence,
          handleHash: event.handleHash,
          handle: event.handle,
          claimedSlot: event.slot,
          claimedAt: event.blockTime,
          active: true,
        };
        this.#handlesByAddress.set(addressKey, handle);
        this.#handleAddressesByName.set(nameKey, addressKey);
        break;
      }
      case 'handle-released': {
        this.#requireHandleAuthority(event.networkId, event.identityId, event.authority);
        const addressKey = handleAddressKey(event.networkId, event.handleClaimAddress);
        const nameKey = handleNameKey(event.networkId, event.handle);
        const current = this.#handlesByAddress.get(addressKey);
        if (
          current === undefined ||
          !current.active ||
          this.#handleAddressesByName.get(nameKey) !== addressKey ||
          current.identityId !== event.identityId ||
          current.handle !== event.handle ||
          current.handleHash !== event.handleHash ||
          event.slot < current.claimedSlot ||
          event.identitySequence <= current.identitySequence
        ) {
          throw stale('Handle release does not exactly match the active indexed claim.');
        }
        this.#handlesByAddress.set(addressKey, {
          ...current,
          authority: event.authority,
          identitySequence: event.identitySequence,
          active: false,
          releasedSlot: event.slot,
          releasedAt: event.blockTime,
        });
        break;
      }
      case 'root-authority-rotated': {
        const identity = this.#requireIdentity(event.identityId);
        if (
          identity.networkId !== event.networkId ||
          identity.rootAuthority !== event.previousRootAuthority ||
          event.rotationCount !== identity.rootRotationCount + 1n
        ) {
          throw stale('Root rotation does not continue the indexed authority epoch.');
        }
        this.#identities.set(event.identityId, {
          ...identity,
          rootAuthority: event.newRootAuthority,
          rootRotationCount: event.rotationCount,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        const history = this.#rootHistory.get(event.identityId) ?? [];
        history.push({
          identityId: event.identityId,
          programId: event.programId,
          authority: event.newRootAuthority,
          rotationCount: event.rotationCount,
          identitySequence: event.identitySequence,
          position,
        });
        this.#rootHistory.set(event.identityId, history);
        break;
      }
      case 'recovery-policy-configured': {
        const identity = this.#requireIdentity(event.identityId);
        const current = this.#recoveryPolicies.get(event.identityId);
        const expectedPolicyAddress = await deriveRecoveryPolicyAddress(
          event.programId,
          identity.identityAddress,
        );
        if (
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== event.rootAuthority ||
          identity.rootRotationCount !== event.rootRotationCount ||
          event.recoveryPolicyAddress !== expectedPolicyAddress ||
          event.policySequence !== (current?.policySequence ?? 0n) + 1n ||
          event.identitySequence <= this.#latestRecoveryIdentitySequence(event.identityId) ||
          (current !== undefined &&
            (current.networkId !== event.networkId ||
              current.recoveryPolicyAddress !== event.recoveryPolicyAddress))
        ) {
          throw stale('Recovery policy event does not continue the indexed identity and policy.');
        }
        this.#recoveryPolicies.set(event.identityId, {
          networkId: event.networkId,
          identityId: event.identityId,
          recoveryPolicyAddress: event.recoveryPolicyAddress,
          rootAuthority: event.rootAuthority,
          policySequence: event.policySequence,
          identitySequence: event.identitySequence,
          rootRotationCount: event.rootRotationCount,
          guardians: event.guardians,
          threshold: event.threshold,
          delaySlots: event.delaySlots,
          active: true,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'recovery-policy-disabled': {
        const identity = this.#requireIdentity(event.identityId);
        const policy = this.#recoveryPolicies.get(event.identityId);
        if (
          policy === undefined ||
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== event.rootAuthority ||
          identity.rootRotationCount !== event.rootRotationCount ||
          policy.networkId !== event.networkId ||
          policy.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          !policy.active ||
          event.policySequence !== policy.policySequence + 1n ||
          event.identitySequence <= this.#latestRecoveryIdentitySequence(event.identityId)
        ) {
          throw stale('Recovery policy disable does not continue the active indexed policy.');
        }
        this.#recoveryPolicies.set(event.identityId, {
          ...policy,
          rootAuthority: event.rootAuthority,
          policySequence: event.policySequence,
          identitySequence: event.identitySequence,
          rootRotationCount: event.rootRotationCount,
          active: false,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'recovery-requested': {
        const identity = this.#requireIdentity(event.identityId);
        const policy = this.#recoveryPolicies.get(event.identityId);
        const requestKey = recoveryRequestKey(event.networkId, event.recoveryRequestAddress);
        const guardianIndex = policy?.guardians.indexOf(event.requestingGuardian) ?? -1;
        const expectedRequestAddress = await deriveRecoveryRequestAddress(
          event.programId,
          identity.identityAddress,
          Uint8Array.from(Buffer.from(event.requestNonce, 'hex')),
        );
        if (
          policy === undefined ||
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== event.currentRootAuthority ||
          identity.rootRotationCount !== event.rootRotationCount ||
          policy.networkId !== event.networkId ||
          policy.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          !policy.active ||
          policy.policySequence !== event.policySequence ||
          policy.threshold !== event.threshold ||
          policy.guardians.length !== event.guardianCount ||
          event.executeAfterSlot !== event.slot + policy.delaySlots ||
          event.identitySequence < this.#latestRecoveryIdentitySequence(event.identityId) ||
          policy.guardians.includes(event.currentRootAuthority) ||
          guardianIndex < 0 ||
          event.recoveryRequestAddress !== expectedRequestAddress ||
          this.#recoveryRequests.has(requestKey)
        ) {
          throw stale('Recovery request does not match the active indexed policy snapshot.');
        }
        this.#recoveryRequests.set(requestKey, {
          networkId: event.networkId,
          identityId: event.identityId,
          recoveryPolicyAddress: event.recoveryPolicyAddress,
          recoveryRequestAddress: event.recoveryRequestAddress,
          requestNonce: event.requestNonce,
          policySequence: event.policySequence,
          currentRootAuthority: event.currentRootAuthority,
          identitySequence: event.identitySequence,
          rootRotationCount: event.rootRotationCount,
          targetRootAuthority: event.targetRootAuthority,
          requestingGuardian: event.requestingGuardian,
          guardians: policy.guardians,
          threshold: event.threshold,
          guardianCount: event.guardianCount,
          approvalsMask: 1 << guardianIndex,
          approvedGuardians: [event.requestingGuardian],
          approvalCount: event.approvalCount,
          requestedSlot: event.slot,
          requestedAt: event.blockTime,
          executeAfterSlot: event.executeAfterSlot,
          state: 'pending',
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'recovery-approved': {
        const identity = this.#requireIdentity(event.identityId);
        const policy = this.#recoveryPolicies.get(event.identityId);
        const requestKey = recoveryRequestKey(event.networkId, event.recoveryRequestAddress);
        const request = this.#recoveryRequests.get(requestKey);
        const guardianBit = 1 << event.guardianIndex;
        if (
          policy === undefined ||
          request === undefined ||
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== request.currentRootAuthority ||
          identity.rootRotationCount !== request.rootRotationCount ||
          policy.networkId !== event.networkId ||
          policy.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          !policy.active ||
          policy.policySequence !== event.policySequence ||
          request.networkId !== event.networkId ||
          request.identityId !== event.identityId ||
          request.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          request.policySequence !== event.policySequence ||
          request.state !== 'pending' ||
          request.threshold !== event.threshold ||
          event.guardianIndex >= request.guardians.length ||
          request.guardians[event.guardianIndex] !== event.guardian ||
          (request.approvalsMask & guardianBit) !== 0 ||
          event.approvalCount !== request.approvalCount + 1
        ) {
          throw stale('Recovery approval does not advance the indexed request exactly once.');
        }
        this.#recoveryRequests.set(requestKey, {
          ...request,
          approvalsMask: request.approvalsMask | guardianBit,
          approvedGuardians: [...request.approvedGuardians, event.guardian],
          approvalCount: event.approvalCount,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'recovery-cancelled': {
        const identity = this.#requireIdentity(event.identityId);
        const requestKey = recoveryRequestKey(event.networkId, event.recoveryRequestAddress);
        const request = this.#recoveryRequests.get(requestKey);
        if (
          request === undefined ||
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== event.cancelledByRootAuthority ||
          identity.rootRotationCount !== event.rootRotationCount ||
          request.networkId !== event.networkId ||
          request.identityId !== event.identityId ||
          request.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          request.policySequence !== event.policySequence ||
          request.targetRootAuthority !== event.targetRootAuthority ||
          request.state !== 'pending' ||
          event.identitySequence <= this.#latestRecoveryIdentitySequence(event.identityId)
        ) {
          throw stale('Recovery cancellation does not close the indexed pending request.');
        }
        this.#recoveryRequests.set(requestKey, {
          ...request,
          state: 'cancelled',
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          terminalIdentitySequence: event.identitySequence,
          terminalRootRotationCount: event.rootRotationCount,
          terminalSlot: event.slot,
          terminalAt: event.blockTime,
          cancelledByRootAuthority: event.cancelledByRootAuthority,
        });
        break;
      }
      case 'recovery-executed': {
        const identity = this.#requireIdentity(event.identityId);
        const policy = this.#recoveryPolicies.get(event.identityId);
        const requestKey = recoveryRequestKey(event.networkId, event.recoveryRequestAddress);
        const request = this.#recoveryRequests.get(requestKey);
        const rootRotation = this.#rootHistory.get(event.identityId)?.at(-1);
        if (
          policy === undefined ||
          request === undefined ||
          rootRotation === undefined ||
          identity.networkId !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.rootAuthority !== event.newRootAuthority ||
          identity.rootRotationCount !== event.rotationCount ||
          policy.networkId !== event.networkId ||
          policy.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          !policy.active ||
          policy.policySequence !== event.policySequence ||
          request.networkId !== event.networkId ||
          request.identityId !== event.identityId ||
          request.recoveryPolicyAddress !== event.recoveryPolicyAddress ||
          request.policySequence !== event.policySequence ||
          request.currentRootAuthority !== event.previousRootAuthority ||
          request.targetRootAuthority !== event.newRootAuthority ||
          request.state !== 'pending' ||
          request.threshold !== event.threshold ||
          request.approvalCount !== event.approvalCount ||
          event.approvalCount < event.threshold ||
          event.identitySequence !== request.identitySequence + 1n ||
          event.identitySequence <= this.#latestRecoveryIdentitySequence(event.identityId) ||
          event.rotationCount !== request.rootRotationCount + 1n ||
          event.slot < request.executeAfterSlot ||
          rootRotation.identitySequence !== event.identitySequence ||
          rootRotation.rotationCount !== event.rotationCount ||
          rootRotation.programId !== event.programId ||
          rootRotation.authority !== event.newRootAuthority ||
          rootRotation.position.slot !== event.slot ||
          rootRotation.position.transactionSignature !== event.transactionSignature ||
          rootRotation.position.logIndex >= event.logIndex ||
          rootRotation.position.transactionIndex !== event.transactionIndex
        ) {
          throw stale('Recovery execution does not close an eligible indexed pending request.');
        }
        this.#recoveryRequests.set(requestKey, {
          ...request,
          state: 'executed',
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          terminalIdentitySequence: event.identitySequence,
          terminalRootRotationCount: event.rotationCount,
          terminalSlot: event.slot,
          terminalAt: event.blockTime,
          executor: event.executor,
        });
        break;
      }
      case 'delegation-created': {
        const identity = this.#requireIdentity(event.identityId);
        const delegationKey = delegationAddressKey(event.networkId, event.delegationAddress);
        if (identity.rootRotationCount !== event.issuedAtRootRotationCount) {
          throw stale('Delegation was issued for a non-current root rotation epoch.');
        }
        if (this.#delegations.has(delegationKey)) {
          throw stale('Delegation address was already projected.');
        }
        this.#delegations.set(delegationKey, {
          identityId: event.identityId,
          delegationAddress: event.delegationAddress,
          delegateAuthority: event.delegateAuthority,
          delegationSequence: event.delegationSequence,
          identitySequence: event.identitySequence,
          scopes: event.scopes,
          issuedAtRootRotationCount: event.issuedAtRootRotationCount,
          issuedAtSlot: event.slot,
          expiresAtSlot: event.expiresAtSlot,
          stateSequence: 1n,
          updatedAt: event.blockTime,
          createdPosition: position,
        });
        break;
      }
      case 'delegation-revoked': {
        this.#requireIdentity(event.identityId);
        const delegationKey = delegationAddressKey(event.networkId, event.delegationAddress);
        const delegation = this.#delegations.get(delegationKey);
        if (
          delegation === undefined ||
          delegation.identityId !== event.identityId ||
          delegation.delegateAuthority !== event.delegateAuthority ||
          delegation.delegationSequence !== event.delegationSequence ||
          delegation.revokedAtSlot !== undefined ||
          event.delegationStateSequence <= delegation.stateSequence
        ) {
          throw stale('Delegation revocation does not continue the indexed delegation state.');
        }
        this.#delegations.set(delegationKey, {
          ...delegation,
          identitySequence: event.identitySequence,
          stateSequence: event.delegationStateSequence,
          revokedAtSlot: event.slot,
          revokedPosition: position,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'profile-updated': {
        const verified = requireManifest(event, manifest, 'profile');
        const content = projectPublicProfileContent(verified.schemaVersion, verified.content);
        this.#requireIdentity(event.identityId);
        // Identity lifecycle validation above already requires the exact next
        // identity sequence and a strictly later event position. Slots alone
        // cannot order two valid transactions finalized in the same slot.
        this.#profiles.set(event.identityId, {
          identityId: event.identityId,
          objectId: verified.objectId,
          cid: verified.cid,
          payloadHash: verified.payloadHash,
          content,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        this.#latestProfileManifestEvents.set(event.identityId, eventKey);
        break;
      }
      case 'post-published': {
        const verified = requireManifest(event, manifest, 'post');
        this.#requireIdentity(event.identityId);
        this.#posts.set(verified.objectId, {
          objectId: verified.objectId,
          networkId: event.networkId,
          authorIdentityId: event.identityId,
          cid: verified.cid,
          payloadHash: verified.payloadHash,
          signingKeyId: verified.signingKeyId,
          content: verified.content as PostProjection['content'],
          // Public chronology is anchored to finalized chain time. The signed
          // manifest timestamp is author-controlled metadata and cannot rank.
          createdAt: event.blockTime,
          anchoredSlot: event.slot,
          transactionSignature: event.transactionSignature,
          verified: true,
        });
        if (event.postReference !== undefined) {
          this.#postReferences.set(
            postReferenceKey(event.networkId, event.postReference),
            verified.objectId,
          );
        }
        break;
      }
      case 'follow-changed': {
        this.#requireIdentity(event.followerIdentityId);
        this.#requireIdentity(event.followedIdentityId);
        const key = edgeKey(event.followerIdentityId, event.followedIdentityId);
        const current = this.#follows.get(key);
        if (current !== undefined && event.edgeStateSequence <= current.sequence) {
          throw stale('Follow event does not advance its state sequence.');
        }
        this.#follows.set(key, {
          followerIdentityId: event.followerIdentityId,
          followedIdentityId: event.followedIdentityId,
          active: event.active,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          sequence: event.edgeStateSequence,
        });
        break;
      }
      case 'block-changed': {
        this.#requireIdentity(event.blockerIdentityId);
        this.#requireIdentity(event.subjectIdentityId);
        const key = edgeKey(event.blockerIdentityId, event.subjectIdentityId);
        const current = this.#blocks.get(key);
        if (current !== undefined && event.edgeStateSequence <= current.stateSequence) {
          throw stale('Block event does not advance its state sequence.');
        }
        this.#blocks.set(key, {
          blockEdgeAddress: event.blockEdgeAddress,
          blockerIdentityId: event.blockerIdentityId,
          subjectIdentityId: event.subjectIdentityId,
          authority: event.authority,
          blockerSequence: event.blockerSequence,
          stateSequence: event.edgeStateSequence,
          active: event.active,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'tombstoned': {
        // Optional legacy tombstone manifest fields are detached audit metadata.
        // The authenticated on-chain target is the canonical suppression signal.
        const post = this.#posts.get(event.targetObjectId);
        if (post !== undefined) {
          this.#posts.set(post.objectId, {
            ...post,
            tombstonedAt: event.blockTime,
          });
        }
        break;
      }
      case 'community-created': {
        this.#requireIdentity(event.creatorIdentityId);
        const key = communityKey(event.networkId, event.communityAddress);
        if (this.#communities.has(key)) {
          throw stale('Community address was already projected.');
        }
        const verified = requireManifest(event, manifest, 'community');
        this.#communities.set(key, {
          ...unverifiedCommunityProjection(event),
          manifestVerified: true,
          objectId: verified.objectId,
          schemaVersion: 2,
          signingKeyId: verified.signingKeyId,
          manifestCreatedAt: verified.createdAt,
          content: verified.content as Extract<
            CommunityProjection,
            { readonly manifestVerified: true }
          >['content'],
        });
        break;
      }
      case 'community-governance-updated': {
        this.#requireIdentity(event.creatorIdentityId);
        const key = communityKey(event.networkId, event.communityAddress);
        const community = this.#communities.get(key);
        if (
          community === undefined ||
          community.creatorIdentityId !== event.creatorIdentityId ||
          community.networkId !== event.networkId ||
          community.governanceVersion !== event.previousGovernanceVersion ||
          community.governanceStrategyHash !== event.previousStrategyHash ||
          event.creatorSequence <= community.creatorSequence
        ) {
          throw stale('Community governance event does not continue the indexed strategy.');
        }
        this.#communities.set(key, {
          ...community,
          latestActionAuthority: event.authority,
          creatorSequence: event.creatorSequence,
          governanceVersion: event.governanceVersion,
          governanceStrategyHash: event.governanceStrategyHash,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'community-membership-changed': {
        this.#requireIdentity(event.memberIdentityId);
        this.#requireIdentity(event.assignedByIdentityId);
        const communityMapKey = communityKey(event.networkId, event.communityAddress);
        const community = this.#communities.get(communityMapKey);
        if (community === undefined) {
          throw new ProjectionError(
            `Community ${event.communityAddress} has not been indexed.`,
            'missing-identity',
          );
        }
        if (
          community.networkId !== event.networkId ||
          community.creatorIdentityId !== event.assignedByIdentityId ||
          event.authoritySequence <= community.creatorSequence
        ) {
          throw stale('Membership event authority does not advance the indexed community.');
        }
        const key = membershipKey(event.networkId, event.communityAddress, event.memberIdentityId);
        const current = this.#memberships.get(key);
        const addressOwner = [...this.#memberships.values()].find(
          (membership) =>
            membership.networkId === event.networkId &&
            membership.membershipAddress === event.membershipAddress,
        );
        if (
          (current !== undefined &&
            (event.membershipStateSequence <= current.stateSequence ||
              event.membershipAddress !== current.membershipAddress)) ||
          (addressOwner !== undefined && addressOwner !== current)
        ) {
          throw stale('Membership event does not advance its state sequence.');
        }
        this.#memberships.set(key, {
          networkId: event.networkId,
          communityAddress: event.communityAddress,
          membershipAddress: event.membershipAddress,
          memberIdentityId: event.memberIdentityId,
          assignedByIdentityId: event.assignedByIdentityId,
          authority: event.authority,
          authoritySequence: event.authoritySequence,
          stateSequence: event.membershipStateSequence,
          roles: event.roles,
          active: event.active,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        this.#communities.set(communityMapKey, {
          ...community,
          latestActionAuthority: event.authority,
          creatorSequence: event.authoritySequence,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'reaction-changed': {
        this.#requireIdentity(event.reactorIdentityId);
        if (
          !this.#postReferences.has(postReferenceKey(event.networkId, event.targetPostReference))
        ) {
          throw new ProjectionError(
            `Post reference ${event.targetPostReference} has not been indexed.`,
            'missing-identity',
          );
        }
        const key = reactionKey(
          event.networkId,
          event.reactorIdentityId,
          event.targetPostReference,
          event.reactionKind,
        );
        const current = this.#reactions.get(key);
        if (current !== undefined && event.reactionStateSequence <= current.stateSequence) {
          throw stale('Reaction event does not advance its state sequence.');
        }
        this.#reactions.set(key, {
          networkId: event.networkId,
          reactionReference: event.reactionReference,
          reactorIdentityId: event.reactorIdentityId,
          targetPostReference: event.targetPostReference,
          authority: event.authority,
          reactionKind: event.reactionKind,
          reactorSequence: event.reactorSequence,
          stateSequence: event.reactionStateSequence,
          active: event.active,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'proposal-created': {
        const proposer = this.#requireIdentity(event.proposerIdentityId);
        const communityMapKey = communityKey(event.networkId, event.communityAddress);
        const community = this.#communities.get(communityMapKey);
        if (community === undefined) {
          throw new ProjectionError(
            `Community ${event.communityAddress} has not been indexed.`,
            'missing-identity',
          );
        }
        if (
          proposer.networkId !== event.networkId ||
          community.networkId !== event.networkId ||
          community.creatorIdentityId !== event.proposerIdentityId ||
          !programMatchesNetwork(event.networkId, event.programId)
        ) {
          throw stale('Proposal proposer does not match the indexed community creator.');
        }
        if (
          event.previousCommunitySequence !== community.creatorSequence ||
          event.proposerSequence <= community.creatorSequence
        ) {
          throw stale('Proposal does not advance the indexed community sequence.');
        }
        if (
          event.governanceVersion !== community.governanceVersion ||
          event.governanceStrategyHash !== community.governanceStrategyHash
        ) {
          throw stale('Proposal governance does not match the indexed community strategy.');
        }
        const expectedProposalAddress = await deriveGovernanceProposalAddress(
          event.programId,
          event.communityAddress,
          event.manifestHash,
        );
        if (event.proposalAddress !== expectedProposalAddress) {
          throw stale('Proposal address is not the canonical governance PDA.');
        }
        const proposalKey = governanceProposalKey(event.networkId, event.proposalAddress);
        if (this.#governanceProposals.has(proposalKey)) {
          throw stale('Proposal address was already projected.');
        }
        const manifestKey = proposalManifestKey(
          event.networkId,
          event.communityAddress,
          event.manifestHash,
        );
        if (this.#proposalByCommunityManifest.has(manifestKey)) {
          throw stale('Proposal manifest was already used in this community.');
        }
        const eligibleMemberCount = [...this.#memberships.values()].filter(
          (membership) =>
            membership.networkId === event.networkId &&
            membership.communityAddress === event.communityAddress &&
            membership.active &&
            (membership.roles & 0x01) === 0x01,
        ).length;
        if (event.eligibleMemberCount !== BigInt(eligibleMemberCount)) {
          throw stale('Proposal eligible-member count does not match the indexed membership set.');
        }
        const proposal: GovernanceProposalProjection = {
          networkId: event.networkId,
          communityAddress: event.communityAddress,
          proposalAddress: event.proposalAddress,
          proposerIdentityId: event.proposerIdentityId,
          authority: event.authority,
          proposerSequence: event.proposerSequence,
          previousCommunitySequence: event.previousCommunitySequence,
          manifestHash: event.manifestHash,
          manifestUri: event.manifestUri,
          manifestVerified: false,
          governanceVersion: event.governanceVersion,
          governanceStrategyHash: event.governanceStrategyHash,
          votingModel: event.votingModel,
          eligibleMemberCount: event.eligibleMemberCount,
          opensAtSlot: event.opensAtSlot,
          closesAtSlot: event.closesAtSlot,
          quorumBps: event.quorumBps,
          approvalBps: event.approvalBps,
          yesVotes: 0n,
          noVotes: 0n,
          abstainVotes: 0n,
          stateSequence: event.proposalStateSequence,
          outcome: 'pending',
          createdSlot: event.slot,
          createdAt: event.blockTime,
        };
        this.#governanceProposals.set(proposalKey, proposal);
        this.#proposalByCommunityManifest.set(manifestKey, event.proposalAddress);
        this.#communities.set(communityMapKey, {
          ...community,
          latestActionAuthority: event.authority,
          creatorSequence: event.proposerSequence,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
        });
        break;
      }
      case 'vote-cast': {
        const voter = this.#requireIdentity(event.voterIdentityId);
        const proposalKey = governanceProposalKey(event.networkId, event.proposalAddress);
        const proposal = this.#governanceProposals.get(proposalKey);
        if (
          proposal === undefined ||
          proposal.networkId !== event.networkId ||
          proposal.communityAddress !== event.communityAddress ||
          !programMatchesNetwork(event.networkId, event.programId)
        ) {
          throw stale('Vote proposal or community does not match indexed governance state.');
        }
        if (
          voter.networkId !== event.networkId ||
          proposal.outcome !== 'pending' ||
          event.slot < proposal.opensAtSlot ||
          event.slot >= proposal.closesAtSlot
        ) {
          throw stale('Vote is not eligible for the indexed proposal voting window.');
        }
        const expectedVoteAddress = await deriveGovernanceVoteAddress(
          event.programId,
          event.proposalAddress,
          voter.identityAddress,
        );
        if (event.voteAddress !== expectedVoteAddress) {
          throw stale('Vote address is not the canonical governance PDA.');
        }
        const expectedMembershipAddress = await deriveCommunityMembershipAddress(
          event.programId,
          event.communityAddress,
          voter.identityAddress,
        );
        if (event.membershipAddress !== expectedMembershipAddress) {
          throw stale('Vote membership is not the canonical community membership PDA.');
        }
        const membership = this.#memberships.get(
          membershipKey(event.networkId, event.communityAddress, event.voterIdentityId),
        );
        if (
          membership === undefined ||
          membership.membershipAddress !== event.membershipAddress ||
          membership.stateSequence !== event.membershipStateSequence ||
          !membership.active ||
          (membership.roles & 0x01) !== 0x01 ||
          membership.updatedSlot > proposal.createdSlot ||
          membership.authoritySequence >= proposal.proposerSequence
        ) {
          throw stale('Vote membership does not match the proposal eligibility snapshot.');
        }
        if (
          this.#governanceVotes.has(governanceVoteKey(event.networkId, event.voteAddress)) ||
          this.#voteByProposalVoter.has(
            proposalVoterKey(event.networkId, event.proposalAddress, event.voterIdentityId),
          )
        ) {
          throw stale('Voter already has a projected vote for this proposal.');
        }
        const priorVoterSequence = this.#lastGovernanceVoterSequence.get(event.voterIdentityId);
        if (priorVoterSequence !== undefined && event.voterSequence <= priorVoterSequence) {
          throw stale('Vote does not advance the voter governance sequence.');
        }
        if (event.proposalStateSequence !== proposal.stateSequence + 1n) {
          throw stale('Vote does not advance the proposal state sequence by one.');
        }
        const expectedYes = proposal.yesVotes + (event.choice === 'yes' ? 1n : 0n);
        const expectedNo = proposal.noVotes + (event.choice === 'no' ? 1n : 0n);
        const expectedAbstain = proposal.abstainVotes + (event.choice === 'abstain' ? 1n : 0n);
        if (
          event.yesVotes !== expectedYes ||
          event.noVotes !== expectedNo ||
          event.abstainVotes !== expectedAbstain ||
          event.yesVotes + event.noVotes + event.abstainVotes > proposal.eligibleMemberCount
        ) {
          throw stale('Vote post-event counts do not exactly advance the indexed tally.');
        }
        const vote: GovernanceVoteProjection = {
          networkId: event.networkId,
          communityAddress: event.communityAddress,
          proposalAddress: event.proposalAddress,
          voteAddress: event.voteAddress,
          voterIdentityId: event.voterIdentityId,
          membershipAddress: event.membershipAddress,
          authority: event.authority,
          voterSequence: event.voterSequence,
          membershipStateSequence: event.membershipStateSequence,
          proposalStateSequence: event.proposalStateSequence,
          choice: event.choice,
          yesVotes: event.yesVotes,
          noVotes: event.noVotes,
          abstainVotes: event.abstainVotes,
          castSlot: event.slot,
          castAt: event.blockTime,
        };
        this.#governanceVotes.set(governanceVoteKey(event.networkId, event.voteAddress), vote);
        this.#voteByProposalVoter.set(
          proposalVoterKey(event.networkId, event.proposalAddress, event.voterIdentityId),
          event.voteAddress,
        );
        this.#lastGovernanceVoterSequence.set(event.voterIdentityId, event.voterSequence);
        this.#governanceProposals.set(proposalKey, {
          ...proposal,
          yesVotes: event.yesVotes,
          noVotes: event.noVotes,
          abstainVotes: event.abstainVotes,
          stateSequence: event.proposalStateSequence,
        });
        break;
      }
      case 'proposal-finalized': {
        const proposalKey = governanceProposalKey(event.networkId, event.proposalAddress);
        const proposal = this.#governanceProposals.get(proposalKey);
        if (
          proposal === undefined ||
          proposal.networkId !== event.networkId ||
          proposal.communityAddress !== event.communityAddress ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          proposal.outcome !== 'pending' ||
          proposal.finalizedSlot !== undefined
        ) {
          throw stale('Finalization does not match a pending indexed proposal.');
        }
        if (
          event.slot < proposal.closesAtSlot ||
          event.proposalStateSequence !== proposal.stateSequence + 1n ||
          event.eligibleMemberCount !== proposal.eligibleMemberCount ||
          event.yesVotes !== proposal.yesVotes ||
          event.noVotes !== proposal.noVotes ||
          event.abstainVotes !== proposal.abstainVotes ||
          event.quorumBps !== proposal.quorumBps ||
          event.approvalBps !== proposal.approvalBps
        ) {
          throw stale(
            'Finalization counts, thresholds, timing, or sequence do not match proposal.',
          );
        }
        const participatingVotes = proposal.yesVotes + proposal.noVotes + proposal.abstainVotes;
        const decisiveVotes = proposal.yesVotes + proposal.noVotes;
        const quorumMet =
          participatingVotes * 10_000n >= proposal.eligibleMemberCount * BigInt(proposal.quorumBps);
        const approvalMet =
          decisiveVotes > 0n &&
          proposal.yesVotes * 10_000n >= decisiveVotes * BigInt(proposal.approvalBps);
        const outcome = quorumMet && approvalMet ? 'accepted' : 'rejected';
        if (
          event.participatingVotes !== participatingVotes ||
          event.decisiveVotes !== decisiveVotes ||
          event.quorumMet !== quorumMet ||
          event.approvalMet !== approvalMet ||
          event.outcome !== outcome
        ) {
          throw stale('Finalization result does not match the canonical vote calculation.');
        }
        this.#governanceProposals.set(proposalKey, {
          ...proposal,
          stateSequence: event.proposalStateSequence,
          outcome: event.outcome,
          finalizer: event.finalizer,
          participatingVotes: event.participatingVotes,
          decisiveVotes: event.decisiveVotes,
          quorumMet: event.quorumMet,
          approvalMet: event.approvalMet,
          finalizedSlot: event.slot,
          finalizedAt: event.blockTime,
        });
        break;
      }
      case 'payment-config-initialized': {
        this.#requirePaymentProtocol(event.networkId, event.programId);
        if (
          event.paymentConfigAddress !== (await derivePaymentConfigAddress(event.programId)) ||
          this.#paymentConfigs.has(event.networkId) ||
          isDefaultPublicKey(event.upgradeAuthority) ||
          isDefaultPublicKey(event.paymentAuthority) ||
          isDefaultPublicKey(event.feeDestination)
        ) {
          throw stale('Payment configuration initialization is substituted or duplicated.');
        }
        this.#paymentConfigs.set(event.networkId, {
          networkId: event.networkId,
          paymentConfigAddress: event.paymentConfigAddress,
          upgradeAuthority: event.upgradeAuthority,
          authority: event.paymentAuthority,
          feeDestination: event.feeDestination,
          feeBps: event.feeBps,
          policySequence: event.policySequence,
          enabled: event.enabled,
          initializedSlot: event.slot,
          initializedAt: event.blockTime,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'payment-config-updated': {
        const current = await this.#requirePaymentConfig(
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        if (
          event.authority !== current.authority ||
          event.previousFeeDestination !== current.feeDestination ||
          event.previousFeeBps !== current.feeBps ||
          event.previousEnabled !== current.enabled ||
          event.policySequence !== current.policySequence + 1n ||
          (event.previousFeeDestination === event.feeDestination &&
            event.previousFeeBps === event.feeBps &&
            event.previousEnabled === event.enabled) ||
          isDefaultPublicKey(event.feeDestination)
        ) {
          throw stale('Payment policy update does not exactly advance indexed policy state.');
        }
        this.#paymentConfigs.set(event.networkId, {
          ...current,
          feeDestination: event.feeDestination,
          feeBps: event.feeBps,
          policySequence: event.policySequence,
          enabled: event.enabled,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'payment-authority-rotated': {
        const current = await this.#requirePaymentConfig(
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        if (
          event.previousAuthority !== current.authority ||
          event.newAuthority === current.authority ||
          isDefaultPublicKey(event.newAuthority) ||
          event.policySequence !== current.policySequence + 1n
        ) {
          throw stale('Payment authority rotation does not advance indexed policy state.');
        }
        this.#paymentConfigs.set(event.networkId, {
          ...current,
          authority: event.newAuthority,
          policySequence: event.policySequence,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'subscription-offering-created': {
        const paymentConfig = await this.#requirePaymentConfig(
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const creator = this.#requireIdentity(event.creatorIdentityId);
        const expectedAddress = await deriveSubscriptionOfferingAddress(
          event.programId,
          creator.identityAddress,
          paymentNonce(event.offeringNonce),
        );
        const offeringKey = paymentAddressKey(event.networkId, event.offeringAddress);
        const priorCreatorSequence = this.#latestPaymentCreatorSequence(event.creatorIdentityId);
        if (
          creator.networkId !== event.networkId ||
          creator.rootAuthority !== event.rootAuthority ||
          creator.rootRotationCount !== event.creatorRootRotationCount ||
          event.offeringAddress !== expectedAddress ||
          this.#subscriptionOfferings.has(offeringKey) ||
          paymentConfig.feeBps > event.maxProtocolFeeBps ||
          (priorCreatorSequence !== undefined && event.creatorSequence <= priorCreatorSequence)
        ) {
          throw stale('Subscription offering does not match indexed creator or payment state.');
        }
        const recipientSplits = this.#paymentSplits(event.networkId, event.recipientSplits);
        if (
          !recipientSplits.some(
            (split) =>
              split.recipientIdentityId === creator.identityId &&
              split.destination === creator.rootAuthority,
          )
        ) {
          throw stale('Subscription offering does not pay its creator root authority.');
        }
        assertPaymentAllocation(event.priceLamports, event.maxProtocolFeeBps, recipientSplits);
        this.#subscriptionOfferings.set(offeringKey, {
          networkId: event.networkId,
          paymentConfigAddress: event.paymentConfigAddress,
          offeringAddress: event.offeringAddress,
          creatorIdentityId: event.creatorIdentityId,
          rootAuthority: event.rootAuthority,
          offeringNonce: event.offeringNonce,
          manifestHash: event.manifestHash,
          manifestUri: event.manifestUri,
          manifestVerified: false,
          priceLamports: event.priceLamports,
          billingInterval: event.billingInterval,
          recipientSplits,
          refundPolicyHash: event.refundPolicyHash,
          maxProtocolFeeBps: event.maxProtocolFeeBps,
          creatorRootRotationCount: event.creatorRootRotationCount,
          creatorSequence: event.creatorSequence,
          stateSequence: event.offeringStateSequence,
          active: true,
          createdSlot: event.slot,
          createdAt: event.blockTime,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'subscription-offering-retired': {
        const offeringKey = paymentAddressKey(event.networkId, event.offeringAddress);
        const current = this.#subscriptionOfferings.get(offeringKey);
        const creator = this.#requireIdentity(event.creatorIdentityId);
        if (
          current === undefined ||
          current.creatorIdentityId !== event.creatorIdentityId ||
          creator.networkId !== event.networkId ||
          creator.rootAuthority !== event.rootAuthority ||
          current.manifestHash !== event.manifestHash ||
          !current.active ||
          current.retiredSlot !== undefined ||
          event.creatorSequence <= current.creatorSequence ||
          event.offeringStateSequence !== current.stateSequence + 1n
        ) {
          throw stale('Subscription retirement does not advance the active indexed offering.');
        }
        this.#subscriptionOfferings.set(offeringKey, {
          ...current,
          rootAuthority: event.rootAuthority,
          creatorSequence: event.creatorSequence,
          stateSequence: event.offeringStateSequence,
          active: false,
          updatedSlot: event.slot,
          updatedAt: event.blockTime,
          retiredSlot: event.slot,
          retiredAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'woke-tip-settled': {
        const paymentConfig = await this.#requirePaymentConfig(
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const payer = this.#requireIdentity(event.payerIdentityId);
        const recipient = this.#requireIdentity(event.recipientIdentityId);
        const receiptKey = paymentAddressKey(event.networkId, event.receiptAddress);
        const expectedReceipt = await derivePaymentReceiptAddress(
          event.programId,
          payer.identityAddress,
          paymentNonce(event.receiptNonce),
        );
        const recipientSplits = this.#paymentSplits(event.networkId, [
          {
            recipientIdentityId: event.recipientIdentityId,
            destination: event.recipientDestination,
            basisPoints: 10_000,
          },
        ]);
        const allocation = assertPaymentAllocation(
          event.grossLamports,
          event.feeBps,
          recipientSplits,
        );
        if (
          !paymentConfig.enabled ||
          event.paymentPolicySequence !== paymentConfig.policySequence ||
          event.feeBps !== paymentConfig.feeBps ||
          event.feeDestination !== paymentConfig.feeDestination ||
          payer.networkId !== event.networkId ||
          payer.rootAuthority !== event.payerAuthority ||
          payer.rootRotationCount !== event.payerRootRotationCount ||
          recipient.networkId !== event.networkId ||
          recipient.rootAuthority !== event.recipientDestination ||
          payer.identityId === recipient.identityId ||
          event.payerAuthority === event.feeDestination ||
          event.payerAuthority === event.recipientDestination ||
          event.feeDestination === event.recipientDestination ||
          event.receiptAddress !== expectedReceipt ||
          this.#paymentReceipts.has(receiptKey) ||
          event.feeLamports !== allocation.feeLamports ||
          event.distributableLamports !== allocation.distributableLamports ||
          event.recipientLamports !== allocation.recipientAmounts[0]
        ) {
          throw stale('Legacy tip receipt does not match indexed identities or payment policy.');
        }
        this.#paymentReceipts.set(receiptKey, {
          networkId: event.networkId,
          receiptAddress: event.receiptAddress,
          paymentConfigAddress: event.paymentConfigAddress,
          termsReference: recipient.identityAddress,
          payerIdentityId: event.payerIdentityId,
          payerAuthority: event.payerAuthority,
          subjectIdentityId: event.recipientIdentityId,
          primaryRecipientDestination: event.recipientDestination,
          receiptNonce: event.receiptNonce,
          paymentKind: event.paymentKind,
          paymentPolicySequence: event.paymentPolicySequence,
          termsStateSequence: 0n,
          termsManifestHash: ZERO_DIGEST,
          payerRootRotationCount: event.payerRootRotationCount,
          grossLamports: event.grossLamports,
          feeBps: event.feeBps,
          feeDestination: event.feeDestination,
          feeLamports: event.feeLamports,
          distributableLamports: event.distributableLamports,
          recipientSplits,
          recipientAmounts: [event.recipientLamports],
          refundPolicyHash: ZERO_DIGEST,
          entitlementFromTimestamp: 0n,
          entitlementUntilTimestamp: 0n,
          paidAtTimestamp: event.paidAtTimestamp,
          paidAtSlot: event.slot,
          recordedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
      case 'subscription-settled': {
        const paymentConfig = await this.#requirePaymentConfig(
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const offeringKey = paymentAddressKey(event.networkId, event.offeringAddress);
        const offering = this.#subscriptionOfferings.get(offeringKey);
        const payer = this.#requireIdentity(event.payerIdentityId);
        const creator = this.#requireIdentity(event.creatorIdentityId);
        const receiptKey = paymentAddressKey(event.networkId, event.receiptAddress);
        const entitlementKey = paymentAddressKey(event.networkId, event.entitlementAddress);
        const currentEntitlement = this.#subscriptionEntitlements.get(entitlementKey);
        const expectedReceipt = await derivePaymentReceiptAddress(
          event.programId,
          payer.identityAddress,
          paymentNonce(event.receiptNonce),
        );
        const expectedEntitlement = await deriveSubscriptionEntitlementAddress(
          event.programId,
          event.offeringAddress,
          payer.identityAddress,
        );
        const recipientSplits = this.#paymentSplits(event.networkId, event.recipientSplits);
        const allocation = assertPaymentAllocation(
          event.grossLamports,
          event.feeBps,
          recipientSplits,
        );
        const expectedWindow = assertSubscriptionWindow(
          event.paidAtTimestamp,
          currentEntitlement?.validUntilTimestamp ?? 0n,
        );
        const expectedStateSequence = (currentEntitlement?.stateSequence ?? 0n) + 1n;
        const expectedSettlementCount = (currentEntitlement?.settlementCount ?? 0n) + 1n;
        if (
          offering === undefined ||
          !offering.active ||
          offering.creatorIdentityId !== event.creatorIdentityId ||
          creator.networkId !== event.networkId ||
          creator.rootRotationCount !== offering.creatorRootRotationCount ||
          payer.networkId !== event.networkId ||
          payer.rootAuthority !== event.payerAuthority ||
          payer.rootRotationCount !== event.payerRootRotationCount ||
          !paymentConfig.enabled ||
          event.paymentPolicySequence !== paymentConfig.policySequence ||
          event.feeBps !== paymentConfig.feeBps ||
          event.feeDestination !== paymentConfig.feeDestination ||
          event.offeringStateSequence !== offering.stateSequence ||
          event.offeringManifestHash !== offering.manifestHash ||
          event.refundPolicyHash !== offering.refundPolicyHash ||
          event.grossLamports !== offering.priceLamports ||
          event.feeBps > offering.maxProtocolFeeBps ||
          !samePaymentSplits(recipientSplits, offering.recipientSplits) ||
          !sameBigInts(event.recipientAmounts, allocation.recipientAmounts) ||
          event.feeLamports !== allocation.feeLamports ||
          event.distributableLamports !== allocation.distributableLamports ||
          recipientSplits.some(
            (split) =>
              split.recipientIdentityId === payer.identityId ||
              split.destination === payer.rootAuthority ||
              split.destination === paymentConfig.feeDestination,
          ) ||
          payer.rootAuthority === paymentConfig.feeDestination ||
          event.receiptAddress !== expectedReceipt ||
          this.#paymentReceipts.has(receiptKey) ||
          event.entitlementAddress !== expectedEntitlement ||
          (currentEntitlement !== undefined &&
            (currentEntitlement.offeringAddress !== event.offeringAddress ||
              currentEntitlement.beneficiaryIdentityId !== event.payerIdentityId ||
              currentEntitlement.refundPolicyHash !== event.refundPolicyHash)) ||
          event.entitlementStateSequence !== expectedStateSequence ||
          event.settlementCount !== expectedSettlementCount ||
          event.entitlementFromTimestamp !== expectedWindow.fromTimestamp ||
          event.entitlementUntilTimestamp !== expectedWindow.untilTimestamp
        ) {
          throw stale('Subscription settlement does not match indexed terms or entitlement state.');
        }
        const creatorSplit = recipientSplits.find(
          (split) => split.recipientIdentityId === event.creatorIdentityId,
        );
        if (creatorSplit === undefined) {
          throw stale('Subscription allocation omits the indexed creator.');
        }
        this.#paymentReceipts.set(receiptKey, {
          networkId: event.networkId,
          receiptAddress: event.receiptAddress,
          paymentConfigAddress: event.paymentConfigAddress,
          termsReference: event.offeringAddress,
          payerIdentityId: event.payerIdentityId,
          payerAuthority: event.payerAuthority,
          subjectIdentityId: event.payerIdentityId,
          primaryRecipientDestination: creatorSplit.destination,
          receiptNonce: event.receiptNonce,
          paymentKind: event.paymentKind,
          paymentPolicySequence: event.paymentPolicySequence,
          termsStateSequence: event.offeringStateSequence,
          termsManifestHash: event.offeringManifestHash,
          payerRootRotationCount: event.payerRootRotationCount,
          grossLamports: event.grossLamports,
          feeBps: event.feeBps,
          feeDestination: event.feeDestination,
          feeLamports: event.feeLamports,
          distributableLamports: event.distributableLamports,
          recipientSplits,
          recipientAmounts: [...event.recipientAmounts],
          refundPolicyHash: event.refundPolicyHash,
          entitlementFromTimestamp: event.entitlementFromTimestamp,
          entitlementUntilTimestamp: event.entitlementUntilTimestamp,
          paidAtTimestamp: event.paidAtTimestamp,
          paidAtSlot: event.slot,
          recordedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        this.#subscriptionEntitlements.set(entitlementKey, {
          networkId: event.networkId,
          entitlementAddress: event.entitlementAddress,
          offeringAddress: event.offeringAddress,
          beneficiaryIdentityId: event.payerIdentityId,
          startedAtTimestamp:
            currentEntitlement?.startedAtTimestamp ?? event.entitlementFromTimestamp,
          validUntilTimestamp: event.entitlementUntilTimestamp,
          settlementCount: event.settlementCount,
          lastReceiptAddress: event.receiptAddress,
          stateSequence: event.entitlementStateSequence,
          lastSettledAtSlot: event.slot,
          refundPolicyHash: event.refundPolicyHash,
          recordedAt: event.blockTime,
          ...paymentProvenance(event),
        });
        break;
      }
    }

    if (sequenceAdvance !== undefined && event.type !== 'identity-deactivated') {
      const identity = this.#requireIdentity(sequenceAdvance.identityId);
      this.#identities.set(sequenceAdvance.identityId, {
        ...identity,
        identitySequence: sequenceAdvance.sequence,
        updatedSlot: event.slot,
        updatedAt: event.blockTime,
      });
      this.#identitySequencePositions.set(sequenceAdvance.identityId, position);
    }

    this.#events.set(eventKey, event);
    const currentCheckpoint = this.#checkpoints.get(event.networkId) ?? -1n;
    if (event.slot > currentCheckpoint) {
      this.#checkpoints.set(event.networkId, event.slot);
    }
    return true;
  }

  async rebuildProjection(
    networkId: string,
    items: readonly ProjectionReplayItem[],
  ): Promise<void> {
    await this.#withNetworkLock(networkId, () => this.#rebuildProjectionUnlocked(networkId, items));
  }

  async #rebuildProjectionUnlocked(
    networkId: string,
    items: readonly ProjectionReplayItem[],
  ): Promise<void> {
    const supplied = new Map<string, ProjectionReplayItem>();
    for (const item of items) {
      if (item.event.networkId !== networkId) {
        throw stale('Projection rebuild contains an event for a different network.');
      }
      const key = keyForEvent(item.event);
      const duplicate = supplied.get(key);
      if (
        duplicate !== undefined &&
        eventFingerprint(duplicate.event) !== eventFingerprint(item.event)
      ) {
        throw eventConflict();
      }
      if (duplicate !== undefined) {
        throw stale('Projection rebuild contains a duplicate raw event coordinate.');
      }
      const dispositions = [
        item.manifest !== undefined,
        item.acceptedManifestSuppression !== undefined,
        item.pendingManifest !== undefined,
        item.terminalFailureCode !== undefined,
      ].filter(Boolean).length;
      if (dispositions > 1) {
        throw eventConflict();
      }
      supplied.set(key, item);
    }
    assertCanonicalAcceptedManifestSuppressions([...supplied.values()]);
    const existing = [...this.#events.entries()].filter(
      ([, event]) => event.networkId === networkId,
    );
    if (existing.length !== supplied.size) {
      throw stale('Projection rebuild must exactly match the immutable raw event source.');
    }
    for (const [key, event] of existing) {
      const item = supplied.get(key);
      if (item === undefined) {
        throw stale('Projection rebuild must exactly match the immutable raw event source.');
      }
      if (eventFingerprint(item.event) !== eventFingerprint(event)) {
        throw eventConflict();
      }
      const terminalFailureCode = this.#terminalManifestFailures.get(key);
      if (terminalFailureCode !== item.terminalFailureCode) {
        throw eventConflict();
      }
      if (this.#pendingManifestEvents.has(key) !== (item.pendingManifest !== undefined)) {
        throw eventConflict();
      }
    }
    assertUnambiguousEventOrder([...supplied.values()].map(({ event }) => event));

    const replacement = new MemoryProjectionStore();
    for (const item of [...supplied.values()].sort((left, right) =>
      compareEventOrder(left.event, right.event),
    )) {
      if (item.pendingManifest !== undefined) {
        await replacement.deferManifestEvent(item.event, item.pendingManifest);
      } else if (item.acceptedManifestSuppression !== undefined) {
        await replacement.#applyAcceptedManifestSuppressionUnlocked(item.event);
      } else if (item.terminalFailureCode === undefined) {
        await replacement.apply(item.event, item.manifest);
      } else {
        await replacement.quarantineManifestEvent(item.event, {
          eventBody: {},
          failureCode: item.terminalFailureCode,
          failureDetail: 'Replayed from the immutable terminal manifest classification.',
        });
      }
    }

    this.#replaceNetworkState(networkId, replacement);
    for (const [key, item] of supplied) {
      this.#events.set(key, item.event);
      if (item.terminalFailureCode !== undefined) {
        const operationalKey = deadLetterKey(
          item.event.networkId,
          item.event.transactionSignature,
          item.event.logIndex,
        );
        this.#deadLetters.set(operationalKey, {
          attempts: this.#deadLetters.get(operationalKey)?.attempts ?? 1,
          terminalFailureCode: item.terminalFailureCode,
        });
      } else if (item.pendingManifest !== undefined) {
        const operationalKey = deadLetterKey(
          item.event.networkId,
          item.event.transactionSignature,
          item.event.logIndex,
        );
        const existingRecord = this.#deadLetters.get(operationalKey);
        const rebuiltDeferral = normalizedManifestDeferral(item.pendingManifest);
        this.#pendingManifestDeferrals.set(key, rebuiltDeferral);
        this.#deadLetters.set(operationalKey, {
          attempts: existingRecord?.attempts ?? 1,
          nextAttemptAt: rebuiltDeferral.nextAttemptAt,
        });
      }
    }
  }

  async #applyAcceptedManifestSuppressionUnlocked(event: ProtocolEvent): Promise<boolean> {
    if (event.type !== 'profile-updated' && event.type !== 'post-published') {
      throw eventConflict();
    }
    const eventKey = keyForEvent(event);
    if (this.#events.has(eventKey)) {
      throw eventConflict();
    }
    const position = positionFor(event);
    const sequenceAdvance = this.#validateIdentityLifecycle(event, position);
    if (sequenceAdvance === undefined) {
      throw stale('A projection-suppressed manifest event must advance one identity sequence.');
    }
    const identity = this.#requireIdentity(sequenceAdvance.identityId);

    if (event.type === 'profile-updated') {
      // A later canonical profile pointer makes these accepted historical
      // bytes unnecessary, but this pointer still superseded prior content.
      this.#profiles.delete(event.identityId);
      this.#latestProfileManifestEvents.set(event.identityId, eventKey);
    } else if (event.postReference !== undefined) {
      // Reference state is on-chain state and survives deletion of the
      // obsolete off-chain manifest.
      this.#postReferences.set(
        postReferenceKey(event.networkId, event.postReference),
        event.objectId,
      );
    }

    this.#identities.set(sequenceAdvance.identityId, {
      ...identity,
      identitySequence: sequenceAdvance.sequence,
      updatedSlot: event.slot,
      updatedAt: event.blockTime,
    });
    this.#identitySequencePositions.set(sequenceAdvance.identityId, position);
    this.#events.set(eventKey, event);
    const currentCheckpoint = this.#checkpoints.get(event.networkId) ?? -1n;
    if (event.slot > currentCheckpoint) {
      this.#checkpoints.set(event.networkId, event.slot);
    }
    return true;
  }

  async advanceCheckpoint(networkId: string, finalizedSlot: bigint): Promise<void> {
    await this.#withNetworkLock(networkId, () => {
      const currentCheckpoint = this.#checkpoints.get(networkId) ?? -1n;
      if (finalizedSlot > currentCheckpoint) {
        this.#checkpoints.set(networkId, finalizedSlot);
      }
      return Promise.resolve();
    });
  }

  async getPost(objectId: string): Promise<PostProjection | undefined> {
    return this.#posts.get(objectId);
  }

  async findPostObjectIdByReference(
    networkId: string,
    onchainReference: string,
  ): Promise<string | undefined> {
    return this.#postReferences.get(postReferenceKey(networkId, onchainReference));
  }

  async getProfile(identityId: string): Promise<ProfileProjection | undefined> {
    return this.#profiles.get(identityId);
  }

  async getIdentity(identityId: string): Promise<IdentityProjection | undefined> {
    return this.#identities.get(identityId);
  }

  async getProtocolConfig(networkId: string): Promise<ProtocolConfigProjection | undefined> {
    return this.#configs.get(networkId);
  }

  async getHandle(networkId: string, handle: string): Promise<HandleProjection | undefined> {
    const addressKey = this.#handleAddressesByName.get(handleNameKey(networkId, handle));
    if (addressKey === undefined) {
      return undefined;
    }
    const projection = this.#handlesByAddress.get(addressKey);
    return projection?.active === true ? publicHandle(projection) : undefined;
  }

  async getHandlesByIdentity(identityId: string): Promise<readonly HandleProjection[]> {
    return [...this.#handlesByAddress.values()]
      .filter((handle) => handle.active && handle.identityId === identityId)
      .sort((left, right) => left.handle.localeCompare(right.handle))
      .map(publicHandle);
  }

  async getDelegations(identityId: string): Promise<readonly DelegationProjection[]> {
    return [...this.#delegations.values()]
      .filter((delegation) => delegation.identityId === identityId)
      .sort((left, right) =>
        left.delegationSequence === right.delegationSequence
          ? left.delegationAddress.localeCompare(right.delegationAddress)
          : left.delegationSequence < right.delegationSequence
            ? -1
            : 1,
      )
      .map(publicDelegation);
  }

  async authorizeSigningKey(query: SigningKeyAuthorizationQuery): Promise<boolean> {
    const history = this.#rootHistory.get(query.identityId);
    if (history === undefined) {
      return false;
    }
    const queryPosition = positionFor(query);
    const deactivated = this.#deactivationPositions.get(query.identityId);
    if (deactivated !== undefined && comparePosition(queryPosition, deactivated) >= 0) {
      return false;
    }
    const root = [...history]
      .filter((item) => comparePosition(item.position, queryPosition) <= 0)
      .sort((left, right) => comparePosition(right.position, left.position))[0];
    if (root === undefined) {
      return false;
    }
    if (query.kind === 'root') {
      return query.authority === root.authority;
    }

    const requiredScope = scopeForObjectType(query.objectType);
    if (requiredScope === undefined) {
      return false;
    }
    return [...this.#delegations.values()].some(
      (delegation) =>
        delegation.identityId === query.identityId &&
        delegation.delegateAuthority === query.authority &&
        delegation.issuedAtRootRotationCount === root.rotationCount &&
        delegation.expiresAtSlot >= query.slot &&
        (delegation.scopes & requiredScope) === requiredScope &&
        comparePosition(delegation.createdPosition, queryPosition) <= 0 &&
        (delegation.revokedPosition === undefined ||
          comparePosition(queryPosition, delegation.revokedPosition) < 0),
    );
  }

  async getBlock(
    blockerIdentityId: string,
    subjectIdentityId: string,
  ): Promise<BlockProjection | undefined> {
    return this.#blocks.get(edgeKey(blockerIdentityId, subjectIdentityId));
  }

  async getCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<CommunityProjection | undefined> {
    return this.#communities.get(communityKey(networkId, communityAddress));
  }

  async listPublicCommunities(query: CommunityDirectoryQuery): Promise<CommunityDirectorySnapshot> {
    assertCommunityDirectoryLimit(query.limit);
    const matches = [...this.#communities.values()]
      .filter(
        (community): community is VerifiedCommunityProjection =>
          community.networkId === query.networkId &&
          community.manifestVerified &&
          community.content.visibility === 'public' &&
          (query.before === undefined ||
            community.createdSlot < query.before.createdSlot ||
            (community.createdSlot === query.before.createdSlot &&
              community.communityAddress < query.before.communityAddress)),
      )
      .sort((left, right) =>
        left.createdSlot === right.createdSlot
          ? compareRawStringsDescending(left.communityAddress, right.communityAddress)
          : left.createdSlot < right.createdSlot
            ? 1
            : -1,
      )
      .slice(0, query.limit + 1);
    const communities = matches.slice(0, query.limit);
    const last = communities.at(-1);
    return {
      checkpoint: this.#checkpoints.get(query.networkId),
      communities,
      ...(matches.length > query.limit && last !== undefined
        ? {
            next: {
              createdSlot: last.createdSlot,
              communityAddress: last.communityAddress,
            },
          }
        : {}),
    };
  }

  async getCommunityMemberships(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly CommunityMembershipProjection[]> {
    return [...this.#memberships.values()]
      .filter(
        (membership) =>
          membership.networkId === networkId && membership.communityAddress === communityAddress,
      )
      .sort((left, right) => left.memberIdentityId.localeCompare(right.memberIdentityId));
  }

  async getReactionsByPostReference(
    networkId: string,
    targetPostReference: string,
  ): Promise<readonly ReactionProjection[]> {
    return [...this.#reactions.values()]
      .filter(
        (reaction) =>
          reaction.networkId === networkId && reaction.targetPostReference === targetPostReference,
      )
      .sort((left, right) => {
        const kind = left.reactionKind - right.reactionKind;
        return kind === 0 ? left.reactorIdentityId.localeCompare(right.reactorIdentityId) : kind;
      });
  }

  async getRecoveryPolicy(identityId: string): Promise<RecoveryPolicyProjection | undefined> {
    return this.#recoveryPolicies.get(identityId);
  }

  async getRecoveryRequest(
    networkId: string,
    recoveryRequestAddress: string,
  ): Promise<RecoveryRequestProjection | undefined> {
    return this.#recoveryRequests.get(recoveryRequestKey(networkId, recoveryRequestAddress));
  }

  async getRecoveryRequestsByIdentity(
    identityId: string,
  ): Promise<readonly RecoveryRequestProjection[]> {
    return [...this.#recoveryRequests.values()]
      .filter((request) => request.identityId === identityId)
      .sort((left, right) =>
        left.requestedSlot === right.requestedSlot
          ? left.recoveryRequestAddress.localeCompare(right.recoveryRequestAddress)
          : left.requestedSlot < right.requestedSlot
            ? -1
            : 1,
      );
  }

  async getGovernanceProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<GovernanceProposalProjection | undefined> {
    return this.#governanceProposals.get(governanceProposalKey(networkId, proposalAddress));
  }

  async getGovernanceProposalsByCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly GovernanceProposalProjection[]> {
    return [...this.#governanceProposals.values()]
      .filter(
        (proposal) =>
          proposal.networkId === networkId && proposal.communityAddress === communityAddress,
      )
      .sort((left, right) =>
        left.createdSlot === right.createdSlot
          ? left.proposalAddress.localeCompare(right.proposalAddress)
          : left.createdSlot < right.createdSlot
            ? -1
            : 1,
      );
  }

  async getGovernanceVote(
    networkId: string,
    voteAddress: string,
  ): Promise<GovernanceVoteProjection | undefined> {
    return this.#governanceVotes.get(governanceVoteKey(networkId, voteAddress));
  }

  async getGovernanceVotesByProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<readonly GovernanceVoteProjection[]> {
    return [...this.#governanceVotes.values()]
      .filter((vote) => vote.networkId === networkId && vote.proposalAddress === proposalAddress)
      .sort((left, right) =>
        left.proposalStateSequence === right.proposalStateSequence
          ? left.voteAddress.localeCompare(right.voteAddress)
          : left.proposalStateSequence < right.proposalStateSequence
            ? -1
            : 1,
      );
  }

  async getPaymentConfig(networkId: string): Promise<PaymentConfigProjection | undefined> {
    return this.#paymentConfigs.get(networkId);
  }

  async getSubscriptionOffering(
    networkId: string,
    offeringAddress: string,
  ): Promise<SubscriptionOfferingProjection | undefined> {
    return this.#subscriptionOfferings.get(paymentAddressKey(networkId, offeringAddress));
  }

  async getSubscriptionOfferingsByCreator(
    networkId: string,
    creatorIdentityId: string,
  ): Promise<readonly SubscriptionOfferingProjection[]> {
    return [...this.#subscriptionOfferings.values()]
      .filter(
        (offering) =>
          offering.networkId === networkId && offering.creatorIdentityId === creatorIdentityId,
      )
      .sort((left, right) =>
        left.createdSlot === right.createdSlot
          ? left.offeringAddress.localeCompare(right.offeringAddress)
          : left.createdSlot < right.createdSlot
            ? -1
            : 1,
      );
  }

  async getPaymentReceipt(
    networkId: string,
    receiptAddress: string,
  ): Promise<PaymentReceiptProjection | undefined> {
    return this.#paymentReceipts.get(paymentAddressKey(networkId, receiptAddress));
  }

  async getSubscriptionEntitlement(
    networkId: string,
    entitlementAddress: string,
  ): Promise<SubscriptionEntitlementProjection | undefined> {
    return this.#subscriptionEntitlements.get(paymentAddressKey(networkId, entitlementAddress));
  }

  async searchPublic(query: PublicSearchQuery): Promise<PublicSearchSnapshot> {
    const term = normalizePublicSearchTerm(query.term);
    const checkpoint = this.#checkpoints.get(query.networkId);
    if (!isValidPublicSearchTerm(term) || query.limit <= 0) {
      return { checkpoint, results: [] };
    }
    const candidates: PublicSearchCandidate[] = [];

    for (const identity of this.#identities.values()) {
      if (identity.networkId !== query.networkId || !identity.active) continue;
      const profile = this.#profiles.get(identity.identityId);
      const handle = [...this.#handlesByAddress.values()]
        .filter(
          (candidate) =>
            candidate.active &&
            candidate.networkId === query.networkId &&
            candidate.identityId === identity.identityId,
        )
        .sort((left, right) => comparePublicSearchText(left.handle, right.handle))[0]?.handle;
      candidates.push({
        kind: 'person',
        identityId: identity.identityId,
        displayName: profile?.content.displayName ?? '',
        bio: profile?.content.bio ?? '',
        ...(handle === undefined ? {} : { handle }),
        updatedAt: profile?.updatedAt ?? identity.updatedAt,
      });
    }

    for (const post of this.#posts.values()) {
      if (
        post.networkId !== query.networkId ||
        post.tombstonedAt !== undefined ||
        post.content.visibility.kind !== 'public'
      ) {
        continue;
      }
      const author = this.#identities.get(post.authorIdentityId);
      if (author === undefined) {
        throw new ProjectionError(
          `Post ${post.objectId} has no indexed author.`,
          'missing-identity',
        );
      }
      const profile = this.#profiles.get(post.authorIdentityId);
      candidates.push({
        kind: 'post',
        entry: {
          post,
          author,
          ...(profile === undefined ? {} : { profile }),
          reason: { kind: 'chronological' },
        },
      });
    }

    for (const community of this.#communities.values()) {
      if (
        community.networkId === query.networkId &&
        community.manifestVerified &&
        community.content.visibility === 'public'
      ) {
        candidates.push({ kind: 'community', community });
      }
    }

    return {
      checkpoint,
      results: rankPublicSearchCandidates(term, candidates, query.limit),
    };
  }

  async getFeed(query: FeedQuery): Promise<readonly FeedEntry[]> {
    const followed =
      query.mode === 'following'
        ? new Set(
            [...this.#follows.values()]
              .filter((edge) => edge.active && edge.followerIdentityId === query.viewerIdentityId)
              .map((edge) => edge.followedIdentityId),
          )
        : undefined;

    return [...this.#posts.values()]
      .filter(
        (post) =>
          post.networkId === query.networkId &&
          post.tombstonedAt === undefined &&
          // No viewer authentication or community policy is evaluated here.
          // Both public and following convenience feeds therefore fail closed
          // to public content only.
          post.content.visibility.kind === 'public' &&
          (followed === undefined || followed.has(post.authorIdentityId)) &&
          (query.before === undefined ||
            post.createdAt < query.before.createdAt ||
            (post.createdAt === query.before.createdAt && post.objectId < query.before.objectId)),
      )
      .sort((left, right) => {
        const time = right.createdAt.localeCompare(left.createdAt);
        if (time !== 0) return time;
        if (left.objectId === right.objectId) return 0;
        return left.objectId > right.objectId ? -1 : 1;
      })
      .slice(0, query.limit)
      .map((post) => {
        const author = this.#identities.get(post.authorIdentityId);
        if (author === undefined) {
          throw new ProjectionError(
            `Post ${post.objectId} has no indexed author.`,
            'missing-identity',
          );
        }
        const profile = this.#profiles.get(post.authorIdentityId);
        return {
          post,
          author,
          ...(profile === undefined ? {} : { profile }),
          reason:
            query.mode === 'following'
              ? {
                  kind: 'following' as const,
                  followedIdentityId: post.authorIdentityId,
                }
              : { kind: 'chronological' as const },
        };
      });
  }

  async getFeedSnapshot(query: FeedQuery): Promise<FeedSnapshot> {
    // getFeed has no await points, so both reads are taken from one
    // uninterrupted in-memory projection state.
    const entries = this.getFeed(query);
    const checkpoint = this.#checkpoints.get(query.networkId);
    return {
      checkpoint,
      entries: await entries,
    };
  }

  async clearProjection(networkId: string): Promise<void> {
    await this.#withNetworkLock(networkId, () => this.#clearProjectionUnlocked(networkId));
  }

  async #clearProjectionUnlocked(networkId: string): Promise<void> {
    this.#configs.delete(networkId);
    for (const [key, event] of this.#events) {
      if (event.networkId === networkId) {
        this.#events.delete(key);
        this.#pendingManifestEvents.delete(key);
        this.#pendingManifestDeferrals.delete(key);
        this.#terminalManifestFailures.delete(key);
      }
    }
    for (const [key, identity] of this.#identities) {
      if (identity.networkId === networkId) {
        this.#identities.delete(key);
        this.#identitySequencePositions.delete(key);
        this.#deactivationPositions.delete(key);
        this.#rootHistory.delete(key);
        this.#profiles.delete(key);
        this.#latestProfileManifestEvents.delete(key);
      }
    }
    for (const [key, handle] of this.#handlesByAddress) {
      if (handle.networkId === networkId) {
        this.#handlesByAddress.delete(key);
        this.#handleAddressesByName.delete(handleNameKey(handle.networkId, handle.handle));
      }
    }
    for (const [key, delegation] of this.#delegations) {
      if (!this.#identities.has(delegation.identityId)) this.#delegations.delete(key);
    }
    for (const [key, post] of this.#posts) {
      if (post.networkId === networkId) this.#posts.delete(key);
    }
    for (const [key] of this.#postReferences) {
      if (key.startsWith(`${networkId}\u0000`)) this.#postReferences.delete(key);
    }
    for (const [key, follow] of this.#follows) {
      if (
        !this.#identities.has(follow.followerIdentityId) ||
        !this.#identities.has(follow.followedIdentityId)
      ) {
        this.#follows.delete(key);
      }
    }
    for (const [key, block] of this.#blocks) {
      if (
        !this.#identities.has(block.blockerIdentityId) ||
        !this.#identities.has(block.subjectIdentityId)
      ) {
        this.#blocks.delete(key);
      }
    }
    for (const [key, community] of this.#communities) {
      if (community.networkId === networkId) this.#communities.delete(key);
    }
    for (const [key, membership] of this.#memberships) {
      if (!this.#communities.has(communityKey(membership.networkId, membership.communityAddress))) {
        this.#memberships.delete(key);
      }
    }
    for (const [key, reaction] of this.#reactions) {
      if (reaction.networkId === networkId) this.#reactions.delete(key);
    }
    for (const [key, request] of this.#recoveryRequests) {
      if (request.networkId === networkId) this.#recoveryRequests.delete(key);
    }
    for (const [key, policy] of this.#recoveryPolicies) {
      if (policy.networkId === networkId) this.#recoveryPolicies.delete(key);
    }
    for (const [key, vote] of this.#governanceVotes) {
      if (vote.networkId === networkId) {
        this.#governanceVotes.delete(key);
        this.#voteByProposalVoter.delete(
          proposalVoterKey(vote.networkId, vote.proposalAddress, vote.voterIdentityId),
        );
      }
    }
    for (const [key, proposal] of this.#governanceProposals) {
      if (proposal.networkId === networkId) {
        this.#governanceProposals.delete(key);
        this.#proposalByCommunityManifest.delete(
          proposalManifestKey(proposal.networkId, proposal.communityAddress, proposal.manifestHash),
        );
      }
    }
    for (const identityId of this.#lastGovernanceVoterSequence.keys()) {
      if (identityId.startsWith(`wokesocialid:v1:${networkId}:`)) {
        this.#lastGovernanceVoterSequence.delete(identityId);
      }
    }
    this.#paymentConfigs.delete(networkId);
    for (const [key, offering] of this.#subscriptionOfferings) {
      if (offering.networkId === networkId) this.#subscriptionOfferings.delete(key);
    }
    for (const [key, receipt] of this.#paymentReceipts) {
      if (receipt.networkId === networkId) this.#paymentReceipts.delete(key);
    }
    for (const [key, entitlement] of this.#subscriptionEntitlements) {
      if (entitlement.networkId === networkId) this.#subscriptionEntitlements.delete(key);
    }
    for (const key of this.#deadLetters.keys()) {
      if (key.startsWith(`${networkId}\u0000`)) this.#deadLetters.delete(key);
    }
    this.#checkpoints.delete(networkId);
  }

  async checkpoint(networkId: string): Promise<bigint | undefined> {
    return this.#checkpoints.get(networkId);
  }

  async deadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<DeadLetterRecord | undefined> {
    return this.#deadLetters.get(deadLetterKey(networkId, transactionSignature, logIndex));
  }

  async recordDeadLetter(input: DeadLetterInput): Promise<DeadLetterRecord> {
    return this.#withNetworkLock(input.networkId, () => {
      const key = deadLetterKey(input.networkId, input.transactionSignature, input.logIndex);
      if (this.#pendingManifestEvents.has(key)) {
        throw new ProjectionError(
          'Pending manifest retries require an exact conditional reschedule.',
          'event-conflict',
        );
      }
      const previous = this.#deadLetters.get(key);
      if (previous?.terminalFailureCode !== undefined) {
        return Promise.resolve(previous);
      }
      const record: DeadLetterRecord = {
        attempts: (previous?.attempts ?? 0) + 1,
        ...(input.nextAttemptAt === undefined ? {} : { nextAttemptAt: input.nextAttemptAt }),
      };
      this.#deadLetters.set(key, record);
      return Promise.resolve(record);
    });
  }

  async resolveDeadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<void> {
    await this.#withNetworkLock(networkId, () => {
      const key = deadLetterKey(networkId, transactionSignature, logIndex);
      if (
        !this.#pendingManifestEvents.has(key) &&
        this.#deadLetters.get(key)?.terminalFailureCode === undefined
      ) {
        this.#deadLetters.delete(key);
      }
      return Promise.resolve();
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  events(networkId: string): readonly ProtocolEvent[] {
    return [...this.#events.values()]
      .filter((event) => event.networkId === networkId)
      .sort(compareEventOrder);
  }

  #validateIdentityLifecycle(
    event: ProtocolEvent,
    position: EventPosition,
  ): IdentitySequenceAdvance | undefined {
    if (event.type === 'identity-deactivated') {
      return undefined;
    }
    for (const identityId of activeIdentityIds(event)) {
      const identity = this.#requireIdentity(identityId);
      if (identity.networkId !== event.networkId || !identity.active) {
        throw stale('Protocol mutation references an inactive or cross-network identity.');
      }
    }

    const snapshot = identitySequenceSnapshot(event);
    if (
      snapshot !== undefined &&
      this.#requireIdentity(snapshot.identityId).identitySequence !== snapshot.sequence
    ) {
      throw stale('Identity sequence snapshot does not match current indexed state.');
    }

    const advance = identitySequenceAdvance(event);
    if (advance === undefined) {
      return undefined;
    }
    const identity = this.#requireIdentity(advance.identityId);
    const currentPosition = this.#identitySequencePositions.get(advance.identityId);
    if (
      advance.sequence !== identity.identitySequence + 1n ||
      currentPosition === undefined ||
      comparePosition(position, currentPosition) <= 0
    ) {
      throw stale('Identity mutation does not exactly advance sequence and event order.');
    }
    return advance;
  }

  #laterTombstoneAt(
    event: Extract<ProtocolEvent, { readonly type: 'post-published' }>,
  ): string | undefined {
    let latest:
      | {
          readonly position: EventPosition;
          readonly blockTime: string;
        }
      | undefined;
    const publishedPosition = positionFor(event);
    for (const candidate of this.#events.values()) {
      if (
        candidate.type !== 'tombstoned' ||
        candidate.networkId !== event.networkId ||
        candidate.identityId !== event.identityId ||
        candidate.targetObjectId !== event.objectId
      ) {
        continue;
      }
      const candidatePosition = positionFor(candidate);
      if (comparePosition(candidatePosition, publishedPosition) <= 0) continue;
      if (latest === undefined || comparePosition(candidatePosition, latest.position) > 0) {
        latest = {
          position: candidatePosition,
          blockTime: candidate.blockTime,
        };
      }
    }
    return latest?.blockTime;
  }

  #requireIdentity(identityId: string): IdentityProjection {
    const identity = this.#identities.get(identityId);
    if (identity === undefined) {
      throw new ProjectionError(`Identity ${identityId} has not been indexed.`, 'missing-identity');
    }
    return identity;
  }

  #requirePaymentProtocol(networkId: string, programId: string): ProtocolConfigProjection {
    const config = this.#configs.get(networkId);
    if (config === undefined || !programMatchesNetwork(networkId, programId)) {
      throw stale('Payment event does not belong to an initialized indexed protocol.');
    }
    return config;
  }

  async #requirePaymentConfig(
    networkId: string,
    programId: string,
    paymentConfigAddress: string,
  ): Promise<PaymentConfigProjection> {
    this.#requirePaymentProtocol(networkId, programId);
    const paymentConfig = this.#paymentConfigs.get(networkId);
    if (
      paymentConfig === undefined ||
      paymentConfig.paymentConfigAddress !== paymentConfigAddress ||
      paymentConfigAddress !== (await derivePaymentConfigAddress(programId))
    ) {
      throw stale('Payment event does not match the canonical indexed payment configuration.');
    }
    return paymentConfig;
  }

  #paymentSplits(
    networkId: string,
    splits: readonly {
      readonly recipientIdentityId: string;
      readonly destination: string;
      readonly basisPoints: number;
    }[],
  ): readonly PaymentRecipientSplitProjection[] {
    return splits.map((split) => {
      const identity = this.#requireIdentity(split.recipientIdentityId);
      if (identity.networkId !== networkId || identity.rootAuthority !== split.destination) {
        throw stale('Payment split recipient does not match an indexed current root authority.');
      }
      return {
        recipientIdentityId: split.recipientIdentityId,
        destination: split.destination,
        basisPoints: split.basisPoints,
      };
    });
  }

  #latestPaymentCreatorSequence(identityId: string): bigint | undefined {
    let latest: bigint | undefined;
    for (const offering of this.#subscriptionOfferings.values()) {
      if (
        offering.creatorIdentityId === identityId &&
        (latest === undefined || offering.creatorSequence > latest)
      ) {
        latest = offering.creatorSequence;
      }
    }
    return latest;
  }

  #requireHandleAuthority(
    networkId: string,
    identityId: string,
    authority: string,
  ): IdentityProjection {
    const identity = this.#requireIdentity(identityId);
    if (identity.networkId !== networkId || identity.rootAuthority !== authority) {
      throw stale('Handle event authority does not match the current identity root authority.');
    }
    return identity;
  }

  #latestRecoveryIdentitySequence(identityId: string): bigint {
    let latest = this.#recoveryPolicies.get(identityId)?.identitySequence ?? 0n;
    for (const request of this.#recoveryRequests.values()) {
      if (request.identityId !== identityId) continue;
      if (request.identitySequence > latest) latest = request.identitySequence;
      if (
        request.terminalIdentitySequence !== undefined &&
        request.terminalIdentitySequence > latest
      ) {
        latest = request.terminalIdentitySequence;
      }
    }
    return latest;
  }

  async #withNetworkLock<Result>(
    networkId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const release = await this.#acquireNetworkLock(networkId);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  #acquireNetworkLock(networkId: string): Promise<() => void> {
    const current = this.#networkMutexes.get(networkId);
    if (current === undefined) {
      const state: NetworkMutexState = { waiters: [] };
      this.#networkMutexes.set(networkId, state);
      return Promise.resolve(this.#releaseNetworkLock(networkId, state));
    }
    return new Promise((resolve) => {
      current.waiters.push(() => {
        resolve(this.#releaseNetworkLock(networkId, current));
      });
    });
  }

  #releaseNetworkLock(networkId: string, state: NetworkMutexState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = state.waiters.shift();
      if (next === undefined) {
        if (this.#networkMutexes.get(networkId) === state) {
          this.#networkMutexes.delete(networkId);
        }
        return;
      }
      next();
    };
  }

  #replaceNetworkState(networkId: string, replacement: MemoryProjectionStore): void {
    this.#configs.delete(networkId);
    for (const [key, identity] of this.#identities) {
      if (identity.networkId === networkId) {
        this.#identities.delete(key);
        this.#identitySequencePositions.delete(key);
        this.#deactivationPositions.delete(key);
        this.#rootHistory.delete(key);
        this.#profiles.delete(key);
        this.#latestProfileManifestEvents.delete(key);
      }
    }
    for (const [key, handle] of this.#handlesByAddress) {
      if (handle.networkId === networkId) {
        this.#handlesByAddress.delete(key);
        this.#handleAddressesByName.delete(handleNameKey(networkId, handle.handle));
      }
    }
    for (const [key, delegation] of this.#delegations) {
      if (delegation.identityId.startsWith(`wokesocialid:v1:${networkId}:`)) {
        this.#delegations.delete(key);
      }
    }
    for (const [key, post] of this.#posts) {
      if (post.networkId === networkId) this.#posts.delete(key);
    }
    for (const key of this.#postReferences.keys()) {
      if (key.startsWith(`${networkId}\u0000`)) this.#postReferences.delete(key);
    }
    for (const [key, follow] of this.#follows) {
      if (
        follow.followerIdentityId.startsWith(`wokesocialid:v1:${networkId}:`) ||
        follow.followedIdentityId.startsWith(`wokesocialid:v1:${networkId}:`)
      ) {
        this.#follows.delete(key);
      }
    }
    for (const [key, block] of this.#blocks) {
      if (
        block.blockerIdentityId.startsWith(`wokesocialid:v1:${networkId}:`) ||
        block.subjectIdentityId.startsWith(`wokesocialid:v1:${networkId}:`)
      ) {
        this.#blocks.delete(key);
      }
    }
    for (const [key, community] of this.#communities) {
      if (community.networkId === networkId) this.#communities.delete(key);
    }
    for (const [key, membership] of this.#memberships) {
      if (membership.networkId === networkId) this.#memberships.delete(key);
    }
    for (const [key, reaction] of this.#reactions) {
      if (reaction.networkId === networkId) this.#reactions.delete(key);
    }
    for (const [key, policy] of this.#recoveryPolicies) {
      if (policy.networkId === networkId) this.#recoveryPolicies.delete(key);
    }
    for (const [key, request] of this.#recoveryRequests) {
      if (request.networkId === networkId) this.#recoveryRequests.delete(key);
    }
    for (const [key, proposal] of this.#governanceProposals) {
      if (proposal.networkId === networkId) this.#governanceProposals.delete(key);
    }
    for (const [key, vote] of this.#governanceVotes) {
      if (vote.networkId === networkId) this.#governanceVotes.delete(key);
    }
    for (const key of this.#proposalByCommunityManifest.keys()) {
      if (key.startsWith(`${networkId}\u0000`)) this.#proposalByCommunityManifest.delete(key);
    }
    for (const key of this.#voteByProposalVoter.keys()) {
      if (key.startsWith(`${networkId}\u0000`)) this.#voteByProposalVoter.delete(key);
    }
    for (const key of this.#lastGovernanceVoterSequence.keys()) {
      if (key.startsWith(`wokesocialid:v1:${networkId}:`)) {
        this.#lastGovernanceVoterSequence.delete(key);
      }
    }
    this.#paymentConfigs.delete(networkId);
    for (const [key, offering] of this.#subscriptionOfferings) {
      if (offering.networkId === networkId) this.#subscriptionOfferings.delete(key);
    }
    for (const [key, receipt] of this.#paymentReceipts) {
      if (receipt.networkId === networkId) this.#paymentReceipts.delete(key);
    }
    for (const [key, entitlement] of this.#subscriptionEntitlements) {
      if (entitlement.networkId === networkId) this.#subscriptionEntitlements.delete(key);
    }

    copyMap(this.#configs, replacement.#configs);
    copyMap(this.#identities, replacement.#identities);
    copyMap(this.#identitySequencePositions, replacement.#identitySequencePositions);
    copyMap(this.#deactivationPositions, replacement.#deactivationPositions);
    copyMap(this.#rootHistory, replacement.#rootHistory);
    copyMap(this.#handlesByAddress, replacement.#handlesByAddress);
    copyMap(this.#handleAddressesByName, replacement.#handleAddressesByName);
    copyMap(this.#delegations, replacement.#delegations);
    copyMap(this.#profiles, replacement.#profiles);
    copyMap(this.#latestProfileManifestEvents, replacement.#latestProfileManifestEvents);
    copyMap(this.#posts, replacement.#posts);
    copyMap(this.#postReferences, replacement.#postReferences);
    copyMap(this.#follows, replacement.#follows);
    copyMap(this.#blocks, replacement.#blocks);
    copyMap(this.#communities, replacement.#communities);
    copyMap(this.#memberships, replacement.#memberships);
    copyMap(this.#reactions, replacement.#reactions);
    copyMap(this.#recoveryPolicies, replacement.#recoveryPolicies);
    copyMap(this.#recoveryRequests, replacement.#recoveryRequests);
    copyMap(this.#governanceProposals, replacement.#governanceProposals);
    copyMap(this.#proposalByCommunityManifest, replacement.#proposalByCommunityManifest);
    copyMap(this.#governanceVotes, replacement.#governanceVotes);
    copyMap(this.#voteByProposalVoter, replacement.#voteByProposalVoter);
    copyMap(this.#lastGovernanceVoterSequence, replacement.#lastGovernanceVoterSequence);
    copyMap(this.#paymentConfigs, replacement.#paymentConfigs);
    copyMap(this.#subscriptionOfferings, replacement.#subscriptionOfferings);
    copyMap(this.#paymentReceipts, replacement.#paymentReceipts);
    copyMap(this.#subscriptionEntitlements, replacement.#subscriptionEntitlements);
    const checkpoint = replacement.#checkpoints.get(networkId);
    if (checkpoint === undefined) this.#checkpoints.delete(networkId);
    else this.#checkpoints.set(networkId, checkpoint);
  }
}

function keyForEvent(event: ProtocolEvent): string {
  return `${event.networkId}\u0000${event.transactionSignature}\u0000${event.logIndex}`;
}

function paymentAddressKey(networkId: string, address: string): string {
  return `${networkId}\u0000${address}`;
}

function paymentNonce(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function paymentProvenance(event: ProtocolEvent) {
  return {
    transactionSignature: event.transactionSignature,
    ...(event.transactionIndex === undefined ? {} : { transactionIndex: event.transactionIndex }),
    logIndex: event.logIndex,
  };
}

function assertPaymentAllocation(
  grossLamports: bigint,
  feeBps: number,
  splits: readonly PaymentRecipientSplitProjection[],
) {
  try {
    return calculatePaymentAllocation(
      grossLamports,
      feeBps,
      splits.map((split) => ({
        ...split,
        recipientIdentityAddress: split.recipientIdentityId.split(':').at(-1) ?? '',
      })),
    );
  } catch (error) {
    throw stale(
      error instanceof PaymentInvariantError
        ? error.message
        : 'Payment allocation violates canonical invariants.',
    );
  }
}

function assertSubscriptionWindow(paidAtTimestamp: bigint, priorValidUntilTimestamp: bigint) {
  try {
    return calculateSubscriptionWindow(paidAtTimestamp, priorValidUntilTimestamp);
  } catch (error) {
    throw stale(
      error instanceof PaymentInvariantError
        ? error.message
        : 'Subscription entitlement window is invalid.',
    );
  }
}

function samePaymentSplits(
  left: readonly PaymentRecipientSplitProjection[],
  right: readonly PaymentRecipientSplitProjection[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (split, index) =>
        split.recipientIdentityId === right[index]?.recipientIdentityId &&
        split.destination === right[index]?.destination &&
        split.basisPoints === right[index]?.basisPoints,
    )
  );
}

function sameBigInts(left: readonly bigint[], right: readonly bigint[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDefaultPublicKey(value: string): boolean {
  return value === '11111111111111111111111111111111';
}

function eventFingerprint(event: ProtocolEvent): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(event)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value]),
    ),
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
  );
}

function copyMap<Key, Value>(target: Map<Key, Value>, source: ReadonlyMap<Key, Value>): void {
  for (const [key, value] of source) target.set(key, value);
}

function postReferenceKey(networkId: string, reference: string): string {
  return `${networkId}\u0000${reference}`;
}

function handleAddressKey(networkId: string, address: string): string {
  return `${networkId}\u0000${address}`;
}

function handleNameKey(networkId: string, handle: string): string {
  return `${networkId}\u0000${handle}`;
}

function delegationAddressKey(networkId: string, delegationAddress: string): string {
  return `${networkId}\u0000${delegationAddress}`;
}

function communityKey(networkId: string, communityAddress: string): string {
  return `${networkId}\u0000${communityAddress}`;
}

function edgeKey(first: string, second: string): string {
  return `${first}\u0000${second}`;
}

function membershipKey(
  networkId: string,
  communityAddress: string,
  memberIdentityId: string,
): string {
  return `${networkId}\u0000${communityAddress}\u0000${memberIdentityId}`;
}

function proposalManifestKey(
  networkId: string,
  communityAddress: string,
  manifestHash: string,
): string {
  return `${networkId}\u0000${communityAddress}\u0000${manifestHash}`;
}

function governanceProposalKey(networkId: string, proposalAddress: string): string {
  return `${networkId}\u0000${proposalAddress}`;
}

function governanceVoteKey(networkId: string, voteAddress: string): string {
  return `${networkId}\u0000${voteAddress}`;
}

function proposalVoterKey(
  networkId: string,
  proposalAddress: string,
  voterIdentityId: string,
): string {
  return `${networkId}\u0000${proposalAddress}\u0000${voterIdentityId}`;
}

function recoveryRequestKey(networkId: string, recoveryRequestAddress: string): string {
  return `${networkId}\u0000${recoveryRequestAddress}`;
}

function programMatchesNetwork(networkId: string, programId: string): boolean {
  return networkId.split(':').at(-1) === programId;
}

function reactionKey(
  networkId: string,
  reactorIdentityId: string,
  targetPostReference: string,
  reactionKind: number,
): string {
  return `${networkId}\u0000${reactorIdentityId}\u0000${targetPostReference}\u0000${reactionKind}`;
}

function unverifiedCommunityProjection(
  event: Extract<ProtocolEvent, { readonly type: 'community-created' }>,
): CommunityProjection {
  return {
    networkId: event.networkId,
    communityAddress: event.communityAddress,
    creatorIdentityId: event.creatorIdentityId,
    manifestAuthority: event.authority,
    latestActionAuthority: event.authority,
    creatorSequence: event.creatorSequence,
    manifestCid: event.manifestCid,
    manifestHash: event.manifestHash,
    manifestVerified: false,
    manifestGovernanceVersion: event.governanceVersion,
    manifestGovernanceStrategyHash: event.governanceStrategyHash,
    governanceVersion: event.governanceVersion,
    governanceStrategyHash: event.governanceStrategyHash,
    createdSlot: event.slot,
    createdAt: event.blockTime,
    updatedSlot: event.slot,
    updatedAt: event.blockTime,
  };
}

function deadLetterKey(networkId: string, signature: string, logIndex: number): string {
  return `${networkId}\u0000${signature}\u0000${logIndex}`;
}

interface IdentitySequenceAdvance {
  readonly identityId: string;
  readonly sequence: bigint;
}

function identitySequenceAdvance(event: ProtocolEvent): IdentitySequenceAdvance | undefined {
  switch (event.type) {
    case 'identity-deactivated':
    case 'handle-claimed':
    case 'handle-released':
    case 'root-authority-rotated':
    case 'delegation-created':
    case 'delegation-revoked':
    case 'recovery-policy-configured':
    case 'recovery-policy-disabled':
    case 'recovery-cancelled':
      return { identityId: event.identityId, sequence: event.identitySequence };
    case 'profile-updated':
    case 'post-published':
    case 'tombstoned':
      return { identityId: event.identityId, sequence: event.sequence };
    case 'follow-changed':
      return {
        identityId: event.followerIdentityId,
        sequence: event.followerSequence,
      };
    case 'block-changed':
      return { identityId: event.blockerIdentityId, sequence: event.blockerSequence };
    case 'community-created':
    case 'community-governance-updated':
      return { identityId: event.creatorIdentityId, sequence: event.creatorSequence };
    case 'community-membership-changed':
      return { identityId: event.assignedByIdentityId, sequence: event.authoritySequence };
    case 'reaction-changed':
      return { identityId: event.reactorIdentityId, sequence: event.reactorSequence };
    case 'proposal-created':
      return { identityId: event.proposerIdentityId, sequence: event.proposerSequence };
    case 'vote-cast':
      return { identityId: event.voterIdentityId, sequence: event.voterSequence };
    case 'subscription-offering-created':
    case 'subscription-offering-retired':
      return { identityId: event.creatorIdentityId, sequence: event.creatorSequence };
    default:
      return undefined;
  }
}

function identitySequenceSnapshot(event: ProtocolEvent): IdentitySequenceAdvance | undefined {
  switch (event.type) {
    case 'recovery-requested':
    case 'recovery-executed':
      return { identityId: event.identityId, sequence: event.identitySequence };
    default:
      return undefined;
  }
}

function activeIdentityIds(event: ProtocolEvent): readonly string[] {
  let identities: readonly string[];
  switch (event.type) {
    case 'identity-deactivated':
    case 'handle-claimed':
    case 'handle-released':
    case 'root-authority-rotated':
    case 'delegation-created':
    case 'delegation-revoked':
    case 'profile-updated':
    case 'post-published':
    case 'tombstoned':
    case 'recovery-policy-configured':
    case 'recovery-policy-disabled':
    case 'recovery-requested':
    case 'recovery-approved':
    case 'recovery-cancelled':
    case 'recovery-executed':
      identities = [event.identityId];
      break;
    case 'follow-changed':
      identities = [event.followerIdentityId, ...(event.active ? [event.followedIdentityId] : [])];
      break;
    case 'block-changed':
      identities = [event.blockerIdentityId, event.subjectIdentityId];
      break;
    case 'community-created':
    case 'community-governance-updated':
      identities = [event.creatorIdentityId];
      break;
    case 'community-membership-changed':
      identities = [event.assignedByIdentityId, event.memberIdentityId];
      break;
    case 'reaction-changed':
      identities = [event.reactorIdentityId];
      break;
    case 'proposal-created':
      identities = [event.proposerIdentityId];
      break;
    case 'vote-cast':
      identities = [event.voterIdentityId];
      break;
    case 'subscription-offering-created':
      identities = [
        event.creatorIdentityId,
        ...event.recipientSplits.map((split) => split.recipientIdentityId),
      ];
      break;
    case 'subscription-offering-retired':
      identities = [event.creatorIdentityId];
      break;
    case 'woke-tip-settled':
      identities = [event.payerIdentityId, event.recipientIdentityId];
      break;
    case 'subscription-settled':
      identities = [
        event.creatorIdentityId,
        event.payerIdentityId,
        ...event.recipientSplits.map((split) => split.recipientIdentityId),
      ];
      break;
    default:
      identities = [];
  }
  return [...new Set(identities)];
}

function positionFor(value: {
  readonly slot: bigint;
  readonly transactionIndex?: number | undefined;
  readonly transactionSignature: string;
  readonly logIndex: number;
}): EventPosition {
  return {
    slot: value.slot,
    transactionIndex: value.transactionIndex,
    transactionSignature: value.transactionSignature,
    logIndex: value.logIndex,
  };
}

function comparePosition(left: EventPosition, right: EventPosition): number {
  if (left.slot !== right.slot) return left.slot < right.slot ? -1 : 1;
  if (
    left.transactionIndex !== undefined &&
    right.transactionIndex !== undefined &&
    left.transactionIndex !== right.transactionIndex
  ) {
    return left.transactionIndex - right.transactionIndex;
  }
  const signature =
    left.transactionSignature === right.transactionSignature
      ? 0
      : left.transactionSignature < right.transactionSignature
        ? -1
        : 1;
  return signature === 0 ? left.logIndex - right.logIndex : signature;
}

function compareRawStringsDescending(left: string, right: string): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function scopeForObjectType(objectType: string): number | undefined {
  if (objectType === 'profile') return 1 << 0;
  if (objectType === 'post') return 1 << 1;
  if (objectType === 'community') return 1 << 3;
  return undefined;
}

function publicDelegation(delegation: StoredDelegation): DelegationProjection {
  return {
    identityId: delegation.identityId,
    delegationAddress: delegation.delegationAddress,
    delegateAuthority: delegation.delegateAuthority,
    delegationSequence: delegation.delegationSequence,
    identitySequence: delegation.identitySequence,
    scopes: delegation.scopes,
    issuedAtRootRotationCount: delegation.issuedAtRootRotationCount,
    issuedAtSlot: delegation.issuedAtSlot,
    expiresAtSlot: delegation.expiresAtSlot,
    stateSequence: delegation.stateSequence,
    ...(delegation.revokedAtSlot === undefined ? {} : { revokedAtSlot: delegation.revokedAtSlot }),
    updatedAt: delegation.updatedAt,
  };
}

function publicHandle(handle: StoredHandle): HandleProjection {
  return {
    networkId: handle.networkId,
    handleClaimAddress: handle.handleClaimAddress,
    identityId: handle.identityId,
    authority: handle.authority,
    identitySequence: handle.identitySequence,
    handleHash: handle.handleHash,
    handle: handle.handle,
    claimedSlot: handle.claimedSlot,
    claimedAt: handle.claimedAt,
  };
}

function normalizedManifestDeferral(deferral: ManifestDeferral): ManifestDeferral {
  if (
    deferral.failureCode !== 'manifest-unavailable' ||
    typeof deferral.failureDetail !== 'string' ||
    typeof deferral.eventBody !== 'object' ||
    deferral.eventBody === null ||
    Array.isArray(deferral.eventBody)
  ) {
    throw new ProjectionError('Pending manifest retry metadata is invalid.', 'manifest-mismatch');
  }
  pendingManifestDueTimestamp(deferral.nextAttemptAt);
  return {
    eventBody: structuredClone(deferral.eventBody),
    failureCode: 'manifest-unavailable',
    failureDetail: deferral.failureDetail,
    nextAttemptAt: deferral.nextAttemptAt,
  };
}

function pendingManifestDueTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new RangeError('Pending manifest due time must be a canonical ISO timestamp.');
  }
  return timestamp;
}

function assertPendingManifestLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError('Pending manifest query limit must be between 1 and 1,000.');
  }
}

function assertCommunityDirectoryLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Community directory limit must be between 1 and 50.');
  }
}

function stale(message: string): ProjectionError {
  return new ProjectionError(message, 'stale-event');
}

function eventConflict(): ProjectionError {
  return new ProjectionError(
    'Event coordinate conflicts with the immutable raw event source.',
    'event-conflict',
  );
}

function requireManifest(
  event: ProtocolEvent,
  manifest: VerifiedManifest | undefined,
  expectedType: VerifiedManifest['type'],
): VerifiedManifest {
  if (manifest === undefined) {
    throw new ProjectionError(`${event.type} requires a verified manifest.`, 'manifest-required');
  }
  if (manifest.type !== expectedType) {
    throw new ProjectionError(
      `Expected ${expectedType}, received ${manifest.type}.`,
      'manifest-mismatch',
    );
  }
  if (
    expectedType === 'community' &&
    (event.type !== 'community-created' ||
      manifest.schemaVersion !== 2 ||
      manifest.signingKeyId !== `${event.creatorIdentityId}#root/${event.authority}`)
  ) {
    throw new ProjectionError(
      'Community manifest signer does not match its immutable creation authority.',
      'manifest-mismatch',
    );
  }
  return manifest;
}
