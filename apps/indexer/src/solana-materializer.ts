import {
  cidSchema,
  decodeCanonicalEnvelope,
  encodeMultibaseBase64Url,
  getObjectId,
} from '@wokesocial/protocol';

import type { DecodedAnchorEvent } from './anchor-events.js';
import { protocolEventSchema, type ProtocolEvent } from './events.js';
import {
  deriveCommunityMembershipAddress,
  deriveGovernanceProposalAddress,
  deriveGovernanceVoteAddress,
} from './governance-addresses.js';
import type { ManifestSource } from './manifest-verifier.js';
import {
  derivePaymentConfigAddress,
  derivePaymentReceiptAddress,
  deriveSubscriptionEntitlementAddress,
  deriveSubscriptionOfferingAddress,
} from './payment-addresses.js';
import type { ProjectionStore } from './projection.js';
import { deriveRecoveryPolicyAddress, deriveRecoveryRequestAddress } from './recovery-addresses.js';

export interface SolanaEventContext {
  readonly networkId: string;
  readonly programId: string;
  readonly transactionSignature: string;
  readonly transactionIndex?: number;
  readonly slot: bigint;
  readonly logIndex: number;
  readonly blockTime: number;
}

export class SolanaEventMaterializationError extends Error {
  override readonly name = 'SolanaEventMaterializationError';

  constructor(
    message: string,
    readonly code:
      | 'unsupported-version'
      | 'slot-mismatch'
      | 'manifest-uri'
      | 'manifest-unavailable'
      | 'manifest-invalid'
      | 'missing-target'
      | 'account-mismatch'
      | 'event-invalid',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class SolanaEventMaterializer {
  constructor(
    private readonly source: ManifestSource,
    private readonly projection: ProjectionStore,
  ) {}

  async materialize(
    decoded: DecodedAnchorEvent,
    context: SolanaEventContext,
  ): Promise<ProtocolEvent> {
    if (decoded.eventVersion !== 1) {
      throw new SolanaEventMaterializationError(
        `Unsupported Anchor event version ${decoded.eventVersion}.`,
        'unsupported-version',
      );
    }
    if (decoded.kind === 'protocol-initialized') {
      this.#assertSlot(decoded.initializedAtSlot, context.slot);
    } else {
      const config = await this.projection.getProtocolConfig(context.networkId);
      if (config !== undefined && config.configAddress !== decoded.config) {
        throw new SolanaEventMaterializationError(
          `Event config ${decoded.config} does not match indexed config ${config.configAddress}.`,
          'account-mismatch',
        );
      }
    }

    const base = {
      networkId: context.networkId,
      programId: context.programId,
      transactionSignature: context.transactionSignature,
      ...(context.transactionIndex === undefined
        ? {}
        : { transactionIndex: context.transactionIndex }),
      slot: context.slot,
      logIndex: context.logIndex,
      blockTime: new Date(context.blockTime * 1_000).toISOString(),
      finalized: true as const,
    };

    switch (decoded.kind) {
      case 'protocol-initialized':
        return {
          ...base,
          type: 'protocol-initialized',
          configAddress: decoded.config,
        };
      case 'identity-created':
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        return {
          ...base,
          type: 'identity-created',
          identityId: identityId(context.networkId, decoded.identity),
          identityAddress: decoded.identity,
          rootAuthority: decoded.rootAuthority,
        };
      case 'handle-claimed':
        this.#assertSlot(decoded.claimedAtSlot, context.slot);
        return {
          ...base,
          type: 'handle-claimed',
          handleClaimAddress: decoded.handleClaim,
          identityId: identityId(context.networkId, decoded.identity),
          authority: decoded.authority,
          identitySequence: decoded.identitySequence,
          handleHash: encodeMultibaseBase64Url(decoded.handleHash),
          handle: decoded.handle,
        };
      case 'handle-released':
        this.#assertSlot(decoded.releasedAtSlot, context.slot);
        return {
          ...base,
          type: 'handle-released',
          handleClaimAddress: decoded.handleClaim,
          identityId: identityId(context.networkId, decoded.identity),
          authority: decoded.authority,
          identitySequence: decoded.identitySequence,
          handleHash: encodeMultibaseBase64Url(decoded.handleHash),
          handle: decoded.handle,
        };
      case 'profile-updated': {
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        const reference = await this.#manifestReference(decoded.manifestUri, decoded.manifestHash);
        return {
          ...base,
          type: 'profile-updated',
          identityId: identityId(context.networkId, decoded.identity),
          authority: decoded.authority,
          objectId: reference.objectId,
          cid: reference.cid,
          payloadHash: reference.payloadHash,
          sequence: decoded.sequence,
        };
      }
      case 'post-published': {
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        const reference = await this.#manifestReference(decoded.manifestUri, decoded.manifestHash);
        return {
          ...base,
          type: 'post-published',
          identityId: identityId(context.networkId, decoded.authorIdentity),
          authority: decoded.authority,
          postReference: decoded.postReference,
          objectId: reference.objectId,
          cid: reference.cid,
          payloadHash: reference.payloadHash,
          sequence: decoded.authorSequence,
        };
      }
      case 'follow-changed':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        return {
          ...base,
          type: 'follow-changed',
          followerIdentityId: identityId(context.networkId, decoded.followerIdentity),
          followedIdentityId: identityId(context.networkId, decoded.subjectIdentity),
          active: decoded.active,
          sequence: decoded.edgeStateSequence,
        };
      case 'post-tombstoned': {
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        const targetObjectId = await this.projection.findPostObjectIdByReference(
          context.networkId,
          decoded.targetPost,
        );
        if (targetObjectId === undefined) {
          throw new SolanaEventMaterializationError(
            `Post reference ${decoded.targetPost} has not been indexed.`,
            'missing-target',
          );
        }
        return {
          ...base,
          type: 'tombstoned',
          identityId: identityId(context.networkId, decoded.authorIdentity),
          targetPostReference: decoded.targetPost,
          targetObjectId,
          sequence: decoded.authorSequence,
        };
      }
      case 'root-authority-rotated':
        this.#assertSlot(decoded.rotatedAtSlot, context.slot);
        return {
          ...base,
          type: 'root-authority-rotated',
          identityId: identityId(context.networkId, decoded.identity),
          previousRootAuthority: decoded.previousRootAuthority,
          newRootAuthority: decoded.newRootAuthority,
          identitySequence: decoded.identitySequence,
          rotationCount: decoded.rotationCount,
        };
      case 'delegation-created':
        this.#assertSlot(decoded.issuedAtSlot, context.slot);
        return {
          ...base,
          type: 'delegation-created',
          identityId: identityId(context.networkId, decoded.identity),
          delegationAddress: decoded.delegation,
          delegateAuthority: decoded.delegateAuthority,
          delegationSequence: decoded.delegationSequence,
          identitySequence: decoded.identitySequence,
          scopes: decoded.scopes,
          issuedAtRootRotationCount: decoded.issuedAtRootRotationCount,
          expiresAtSlot: decoded.expiresAtSlot,
        };
      case 'delegation-revoked':
        this.#assertSlot(decoded.revokedAtSlot, context.slot);
        return {
          ...base,
          type: 'delegation-revoked',
          identityId: identityId(context.networkId, decoded.identity),
          delegationAddress: decoded.delegation,
          delegateAuthority: decoded.delegateAuthority,
          delegationSequence: decoded.delegationSequence,
          identitySequence: decoded.identitySequence,
          delegationStateSequence: decoded.delegationStateSequence,
        };
      case 'block-changed':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        return {
          ...base,
          type: 'block-changed',
          blockEdgeAddress: decoded.blockEdge,
          blockerIdentityId: identityId(context.networkId, decoded.blockerIdentity),
          subjectIdentityId: identityId(context.networkId, decoded.subjectIdentity),
          authority: decoded.authority,
          blockerSequence: decoded.blockerSequence,
          edgeStateSequence: decoded.edgeStateSequence,
          active: decoded.active,
        };
      case 'community-created':
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        return {
          ...base,
          type: 'community-created',
          communityAddress: decoded.community,
          creatorIdentityId: identityId(context.networkId, decoded.creatorIdentity),
          authority: decoded.authority,
          creatorSequence: decoded.creatorSequence,
          manifestCid: manifestCid(decoded.manifestUri),
          manifestHash: encodeMultibaseBase64Url(decoded.manifestHash),
          governanceVersion: decoded.governanceVersion,
          governanceStrategyHash: encodeMultibaseBase64Url(decoded.governanceStrategyHash),
        };
      case 'community-governance-updated':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        return {
          ...base,
          type: 'community-governance-updated',
          communityAddress: decoded.community,
          creatorIdentityId: identityId(context.networkId, decoded.creatorIdentity),
          authority: decoded.authority,
          creatorSequence: decoded.creatorSequence,
          previousGovernanceVersion: decoded.previousGovernanceVersion,
          governanceVersion: decoded.governanceVersion,
          previousStrategyHash: encodeMultibaseBase64Url(decoded.previousStrategyHash),
          governanceStrategyHash: encodeMultibaseBase64Url(decoded.governanceStrategyHash),
        };
      case 'community-membership-changed':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        return {
          ...base,
          type: 'community-membership-changed',
          communityAddress: decoded.community,
          membershipAddress: decoded.membership,
          memberIdentityId: identityId(context.networkId, decoded.memberIdentity),
          assignedByIdentityId: identityId(context.networkId, decoded.assignedByIdentity),
          authority: decoded.authority,
          authoritySequence: decoded.authoritySequence,
          membershipStateSequence: decoded.membershipStateSequence,
          roles: decoded.roles,
          active: decoded.active,
        };
      case 'reaction-changed':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        return {
          ...base,
          type: 'reaction-changed',
          reactionReference: decoded.reactionReference,
          reactorIdentityId: identityId(context.networkId, decoded.reactorIdentity),
          targetPostReference: decoded.targetPost,
          authority: decoded.authority,
          reactionKind: decoded.reactionKind,
          reactorSequence: decoded.reactorSequence,
          reactionStateSequence: decoded.reactionStateSequence,
          active: decoded.active,
        };
      case 'recovery-policy-configured':
        this.#assertSlot(decoded.configuredAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        return this.#validatedEvent({
          ...base,
          type: 'recovery-policy-configured',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          rootAuthority: decoded.rootAuthority,
          policySequence: decoded.policySequence,
          identitySequence: decoded.identitySequence,
          rootRotationCount: decoded.rootRotationCount,
          guardians: decoded.guardians,
          threshold: decoded.threshold,
          delaySlots: decoded.delaySlots,
        });
      case 'recovery-policy-disabled':
        this.#assertSlot(decoded.disabledAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        return this.#validatedEvent({
          ...base,
          type: 'recovery-policy-disabled',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          rootAuthority: decoded.rootAuthority,
          policySequence: decoded.policySequence,
          identitySequence: decoded.identitySequence,
          rootRotationCount: decoded.rootRotationCount,
        });
      case 'recovery-requested':
        this.#assertSlot(decoded.requestedAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        if (
          decoded.recoveryRequest !==
          (await deriveRecoveryRequestAddress(
            context.programId,
            decoded.identity,
            decoded.requestNonce,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Recovery event contains a substituted request account.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'recovery-requested',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          recoveryRequestAddress: decoded.recoveryRequest,
          requestingGuardian: decoded.requestingGuardian,
          requestNonce: Buffer.from(decoded.requestNonce).toString('hex'),
          policySequence: decoded.policySequence,
          currentRootAuthority: decoded.currentRootAuthority,
          identitySequence: decoded.identitySequence,
          rootRotationCount: decoded.rootRotationCount,
          targetRootAuthority: decoded.targetRootAuthority,
          threshold: decoded.threshold,
          guardianCount: decoded.guardianCount,
          approvalCount: decoded.approvalCount,
          executeAfterSlot: decoded.executeAfterSlot,
        });
      case 'recovery-approved':
        this.#assertSlot(decoded.approvedAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        return this.#validatedEvent({
          ...base,
          type: 'recovery-approved',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          recoveryRequestAddress: decoded.recoveryRequest,
          guardian: decoded.guardian,
          guardianIndex: decoded.guardianIndex,
          policySequence: decoded.policySequence,
          approvalCount: decoded.approvalCount,
          threshold: decoded.threshold,
        });
      case 'recovery-cancelled':
        this.#assertSlot(decoded.cancelledAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        return this.#validatedEvent({
          ...base,
          type: 'recovery-cancelled',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          recoveryRequestAddress: decoded.recoveryRequest,
          cancelledByRootAuthority: decoded.cancelledByRootAuthority,
          targetRootAuthority: decoded.targetRootAuthority,
          policySequence: decoded.policySequence,
          identitySequence: decoded.identitySequence,
          rootRotationCount: decoded.rootRotationCount,
        });
      case 'recovery-executed':
        this.#assertSlot(decoded.executedAtSlot, context.slot);
        await this.#assertRecoveryPolicyAddress(
          context.programId,
          decoded.identity,
          decoded.recoveryPolicy,
        );
        return this.#validatedEvent({
          ...base,
          type: 'recovery-executed',
          identityId: identityId(context.networkId, decoded.identity),
          recoveryPolicyAddress: decoded.recoveryPolicy,
          recoveryRequestAddress: decoded.recoveryRequest,
          executor: decoded.executor,
          previousRootAuthority: decoded.previousRootAuthority,
          newRootAuthority: decoded.newRootAuthority,
          policySequence: decoded.policySequence,
          approvalCount: decoded.approvalCount,
          threshold: decoded.threshold,
          identitySequence: decoded.identitySequence,
          rotationCount: decoded.rotationCount,
        });
      case 'payment-config-initialized':
        this.#assertSlot(decoded.initializedAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        return this.#validatedEvent({
          ...base,
          type: 'payment-config-initialized',
          paymentConfigAddress: decoded.paymentConfig,
          upgradeAuthority: decoded.upgradeAuthority,
          paymentAuthority: decoded.paymentAuthority,
          feeDestination: decoded.feeDestination,
          feeBps: decoded.feeBps,
          policySequence: decoded.policySequence,
          enabled: decoded.enabled,
        });
      case 'payment-config-updated':
        this.#assertSlot(decoded.updatedAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        return this.#validatedEvent({
          ...base,
          type: 'payment-config-updated',
          paymentConfigAddress: decoded.paymentConfig,
          authority: decoded.authority,
          previousFeeDestination: decoded.previousFeeDestination,
          feeDestination: decoded.feeDestination,
          previousFeeBps: decoded.previousFeeBps,
          feeBps: decoded.feeBps,
          previousEnabled: decoded.previousEnabled,
          enabled: decoded.enabled,
          policySequence: decoded.policySequence,
        });
      case 'payment-authority-rotated':
        this.#assertSlot(decoded.rotatedAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        return this.#validatedEvent({
          ...base,
          type: 'payment-authority-rotated',
          paymentConfigAddress: decoded.paymentConfig,
          previousAuthority: decoded.previousAuthority,
          newAuthority: decoded.newAuthority,
          policySequence: decoded.policySequence,
        });
      case 'subscription-offering-created':
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        if (
          decoded.offering !==
          (await deriveSubscriptionOfferingAddress(
            context.programId,
            decoded.creatorIdentity,
            decoded.offeringNonce,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Payment event contains a substituted subscription offering.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'subscription-offering-created',
          paymentConfigAddress: decoded.paymentConfig,
          offeringAddress: decoded.offering,
          creatorIdentityId: identityId(context.networkId, decoded.creatorIdentity),
          rootAuthority: decoded.rootAuthority,
          offeringNonce: Buffer.from(decoded.offeringNonce).toString('hex'),
          manifestHash: encodeMultibaseBase64Url(decoded.manifestHash),
          manifestUri: decoded.manifestUri,
          priceLamports: decoded.priceLamports,
          billingInterval: decoded.billingInterval,
          recipientSplits: decoded.recipientSplits.map((split) => ({
            recipientIdentityId: identityId(context.networkId, split.recipientIdentity),
            destination: split.destination,
            basisPoints: split.basisPoints,
          })),
          refundPolicyHash: encodeMultibaseBase64Url(decoded.refundPolicyHash),
          maxProtocolFeeBps: decoded.maxProtocolFeeBps,
          creatorRootRotationCount: decoded.creatorRootRotationCount,
          creatorSequence: decoded.creatorSequence,
          offeringStateSequence: decoded.offeringStateSequence,
        });
      case 'subscription-offering-retired':
        this.#assertSlot(decoded.retiredAtSlot, context.slot);
        return this.#validatedEvent({
          ...base,
          type: 'subscription-offering-retired',
          offeringAddress: decoded.offering,
          creatorIdentityId: identityId(context.networkId, decoded.creatorIdentity),
          rootAuthority: decoded.rootAuthority,
          manifestHash: encodeMultibaseBase64Url(decoded.manifestHash),
          creatorSequence: decoded.creatorSequence,
          offeringStateSequence: decoded.offeringStateSequence,
        });
      case 'woke-tip-settled':
        this.#assertSlot(decoded.paidAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        if (
          decoded.receipt !==
          (await derivePaymentReceiptAddress(
            context.programId,
            decoded.payerIdentity,
            decoded.receiptNonce,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Payment event contains a substituted receipt.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'woke-tip-settled',
          paymentConfigAddress: decoded.paymentConfig,
          receiptAddress: decoded.receipt,
          payerIdentityId: identityId(context.networkId, decoded.payerIdentity),
          payerAuthority: decoded.payerAuthority,
          recipientIdentityId: identityId(context.networkId, decoded.recipientIdentity),
          recipientDestination: decoded.recipientDestination,
          receiptNonce: Buffer.from(decoded.receiptNonce).toString('hex'),
          paymentKind: decoded.paymentKind,
          payerRootRotationCount: decoded.payerRootRotationCount,
          paymentPolicySequence: decoded.paymentPolicySequence,
          grossLamports: decoded.grossLamports,
          feeBps: decoded.feeBps,
          feeDestination: decoded.feeDestination,
          feeLamports: decoded.feeLamports,
          distributableLamports: decoded.distributableLamports,
          recipientLamports: decoded.recipientLamports,
          paidAtTimestamp: decoded.paidAtTimestamp,
        });
      case 'subscription-settled':
        this.#assertSlot(decoded.paidAtSlot, context.slot);
        await this.#assertPaymentConfigAddress(context.programId, decoded.paymentConfig);
        if (
          decoded.receipt !==
          (await derivePaymentReceiptAddress(
            context.programId,
            decoded.payerIdentity,
            decoded.receiptNonce,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Payment event contains a substituted receipt.',
            'account-mismatch',
          );
        }
        if (
          decoded.entitlement !==
          (await deriveSubscriptionEntitlementAddress(
            context.programId,
            decoded.offering,
            decoded.payerIdentity,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Payment event contains a substituted subscription entitlement.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'subscription-settled',
          paymentConfigAddress: decoded.paymentConfig,
          offeringAddress: decoded.offering,
          receiptAddress: decoded.receipt,
          entitlementAddress: decoded.entitlement,
          creatorIdentityId: identityId(context.networkId, decoded.creatorIdentity),
          payerIdentityId: identityId(context.networkId, decoded.payerIdentity),
          payerAuthority: decoded.payerAuthority,
          receiptNonce: Buffer.from(decoded.receiptNonce).toString('hex'),
          paymentKind: decoded.paymentKind,
          payerRootRotationCount: decoded.payerRootRotationCount,
          paymentPolicySequence: decoded.paymentPolicySequence,
          offeringStateSequence: decoded.offeringStateSequence,
          offeringManifestHash: encodeMultibaseBase64Url(decoded.offeringManifestHash),
          refundPolicyHash: encodeMultibaseBase64Url(decoded.refundPolicyHash),
          grossLamports: decoded.grossLamports,
          feeBps: decoded.feeBps,
          feeDestination: decoded.feeDestination,
          feeLamports: decoded.feeLamports,
          distributableLamports: decoded.distributableLamports,
          recipientSplits: decoded.recipientSplits.map((split) => ({
            recipientIdentityId: identityId(context.networkId, split.recipientIdentity),
            destination: split.destination,
            basisPoints: split.basisPoints,
          })),
          recipientAmounts: decoded.recipientAmounts,
          entitlementStateSequence: decoded.entitlementStateSequence,
          settlementCount: decoded.settlementCount,
          entitlementFromTimestamp: decoded.entitlementFromTimestamp,
          entitlementUntilTimestamp: decoded.entitlementUntilTimestamp,
          paidAtTimestamp: decoded.paidAtTimestamp,
        });
      case 'proposal-created':
        this.#assertSlot(decoded.createdAtSlot, context.slot);
        if (
          decoded.proposal !==
          (await deriveGovernanceProposalAddress(
            context.programId,
            decoded.community,
            encodeMultibaseBase64Url(decoded.manifestHash),
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Proposal event contains a substituted proposal account.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'proposal-created',
          communityAddress: decoded.community,
          proposalAddress: decoded.proposal,
          proposerIdentityId: identityId(context.networkId, decoded.proposerIdentity),
          authority: decoded.authority,
          proposerSequence: decoded.proposerSequence,
          previousCommunitySequence: decoded.previousCommunitySequence,
          manifestHash: encodeMultibaseBase64Url(decoded.manifestHash),
          manifestUri: decoded.manifestUri,
          governanceVersion: decoded.governanceVersion,
          governanceStrategyHash: encodeMultibaseBase64Url(decoded.governanceStrategyHash),
          votingModel: decoded.votingModel,
          eligibleMemberCount: decoded.eligibleMemberCount,
          opensAtSlot: decoded.opensAtSlot,
          closesAtSlot: decoded.closesAtSlot,
          quorumBps: decoded.quorumBps,
          approvalBps: decoded.approvalBps,
          proposalStateSequence: decoded.proposalStateSequence,
        });
      case 'vote-cast':
        this.#assertSlot(decoded.castAtSlot, context.slot);
        if (
          decoded.vote !==
          (await deriveGovernanceVoteAddress(
            context.programId,
            decoded.proposal,
            decoded.voterIdentity,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Vote event contains a substituted vote account.',
            'account-mismatch',
          );
        }
        if (
          decoded.membership !==
          (await deriveCommunityMembershipAddress(
            context.programId,
            decoded.community,
            decoded.voterIdentity,
          ))
        ) {
          throw new SolanaEventMaterializationError(
            'Vote event contains a substituted membership account.',
            'account-mismatch',
          );
        }
        return this.#validatedEvent({
          ...base,
          type: 'vote-cast',
          communityAddress: decoded.community,
          proposalAddress: decoded.proposal,
          voteAddress: decoded.vote,
          voterIdentityId: identityId(context.networkId, decoded.voterIdentity),
          membershipAddress: decoded.membership,
          authority: decoded.authority,
          voterSequence: decoded.voterSequence,
          membershipStateSequence: decoded.membershipStateSequence,
          proposalStateSequence: decoded.proposalStateSequence,
          choice: decoded.choice,
          yesVotes: decoded.yesVotes,
          noVotes: decoded.noVotes,
          abstainVotes: decoded.abstainVotes,
        });
      case 'proposal-finalized':
        this.#assertSlot(decoded.finalizedAtSlot, context.slot);
        return this.#validatedEvent({
          ...base,
          type: 'proposal-finalized',
          communityAddress: decoded.community,
          proposalAddress: decoded.proposal,
          finalizer: decoded.finalizer,
          proposalStateSequence: decoded.proposalStateSequence,
          eligibleMemberCount: decoded.eligibleMemberCount,
          yesVotes: decoded.yesVotes,
          noVotes: decoded.noVotes,
          abstainVotes: decoded.abstainVotes,
          participatingVotes: decoded.participatingVotes,
          decisiveVotes: decoded.decisiveVotes,
          quorumBps: decoded.quorumBps,
          approvalBps: decoded.approvalBps,
          quorumMet: decoded.quorumMet,
          approvalMet: decoded.approvalMet,
          outcome: decoded.outcome,
        });
    }
  }

  async #manifestReference(
    manifestUri: string,
    manifestHash: Uint8Array,
  ): Promise<{
    readonly objectId: string;
    readonly cid: string;
    readonly payloadHash: string;
  }> {
    const cid = manifestCid(manifestUri);
    let bytes: Uint8Array;
    try {
      bytes = await this.source.get(cid);
    } catch (error) {
      throw new SolanaEventMaterializationError(
        `Manifest ${cid} is not available from configured content storage.`,
        'manifest-unavailable',
        { cause: error },
      );
    }
    try {
      const envelope = decodeCanonicalEnvelope(bytes);
      return {
        objectId: getObjectId(envelope.payload),
        cid,
        payloadHash: encodeMultibaseBase64Url(manifestHash),
      };
    } catch (error) {
      throw new SolanaEventMaterializationError(
        `Manifest ${cid} is invalid or non-canonical.`,
        'manifest-invalid',
        { cause: error },
      );
    }
  }

  #assertSlot(eventSlot: bigint, transactionSlot: bigint): void {
    if (eventSlot !== transactionSlot) {
      throw new SolanaEventMaterializationError(
        `Event slot ${eventSlot.toString()} does not match transaction slot ${transactionSlot.toString()}.`,
        'slot-mismatch',
      );
    }
  }

  async #assertRecoveryPolicyAddress(
    programId: string,
    identityAddress: string,
    recoveryPolicyAddress: string,
  ): Promise<void> {
    if (recoveryPolicyAddress !== (await deriveRecoveryPolicyAddress(programId, identityAddress))) {
      throw new SolanaEventMaterializationError(
        'Recovery event contains a substituted policy account.',
        'account-mismatch',
      );
    }
  }

  async #assertPaymentConfigAddress(
    programId: string,
    paymentConfigAddress: string,
  ): Promise<void> {
    if (paymentConfigAddress !== (await derivePaymentConfigAddress(programId))) {
      throw new SolanaEventMaterializationError(
        'Payment event contains a substituted payment configuration.',
        'account-mismatch',
      );
    }
  }

  #validatedEvent(input: unknown): ProtocolEvent {
    try {
      return protocolEventSchema.parse(input);
    } catch (error) {
      throw new SolanaEventMaterializationError(
        'Anchor event violates the canonical protocol event schema.',
        'event-invalid',
        { cause: error },
      );
    }
  }
}

function identityId(networkId: string, identityAddress: string): string {
  return `wokesocialid:v1:${networkId}:${identityAddress}`;
}

function manifestCid(manifestUri: string): string {
  let candidate: string | undefined;
  try {
    const parsed = new URL(manifestUri);
    if (parsed.protocol === 'ipfs:') {
      candidate = parsed.hostname || parsed.pathname.replace(/^\/+/u, '').split('/')[0];
    } else if (parsed.protocol === 'https:') {
      candidate = parsed.pathname.split('/').filter(Boolean).at(-1);
    }
  } catch {
    candidate = undefined;
  }

  const parsed = cidSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new SolanaEventMaterializationError(
      `Manifest URI ${manifestUri} does not contain a supported CIDv1 reference.`,
      'manifest-uri',
    );
  }
  return parsed.data;
}
