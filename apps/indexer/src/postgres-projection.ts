import postgres, { type Sql, type TransactionSql } from 'postgres';

import { compareEventOrder, type ProtocolEvent } from './events.js';
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
  PaymentRecipientSplitProjection,
  PostProjection,
  ProfileProjection,
  ProtocolConfigProjection,
  ReactionProjection,
  RecoveryPolicyProjection,
  RecoveryRequestProjection,
  SigningKeyAuthorizationQuery,
  SubscriptionEntitlementProjection,
  SubscriptionOfferingProjection,
} from './models.js';
import {
  ProjectionError,
  type DeadLetterInput,
  type DeadLetterRecord,
  type IngestionStateStore,
  type ProjectionReplayItem,
  type ProjectionStore,
  type VerifiedManifest,
} from './projection.js';

const ZERO_DIGEST = 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class PostgresProjectionStore implements ProjectionStore, IngestionStateStore {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }

  async apply(event: ProtocolEvent, manifest?: VerifiedManifest): Promise<boolean> {
    try {
      return await this.#sql.begin(async (sql) => {
        await this.#lockNetwork(sql, event.networkId);
        return this.#applyInTransaction(sql, event, manifest, false);
      });
    } catch (error) {
      throw projectionError(error);
    }
  }

  async rebuildProjection(
    networkId: string,
    items: readonly ProjectionReplayItem[],
  ): Promise<void> {
    try {
      await this.#sql.begin(async (sql) => {
        await this.#lockNetwork(sql, networkId);
        const supplied = new Map<string, ProjectionReplayItem>();
        for (const item of items) {
          if (item.event.networkId !== networkId) {
            throw stale('Projection rebuild contains an event for a different network.');
          }
          const key = eventKey(item.event);
          const duplicate = supplied.get(key);
          if (
            duplicate !== undefined &&
            eventFingerprint(duplicate.event) !== eventFingerprint(item.event)
          ) {
            throw eventConflict();
          }
          supplied.set(key, item);
        }
        const existing = await sql<{ transaction_signature: string; log_index: number }[]>`
          SELECT transaction_signature, log_index
          FROM protocol_events
          WHERE network_id = ${networkId}
        `;
        if (
          existing.some(
            (row) =>
              !supplied.has(eventKeyParts(networkId, row.transaction_signature, row.log_index)),
          )
        ) {
          throw stale('Projection rebuild must preserve the complete immutable raw event source.');
        }

        await this.#clearMaterializedProjection(sql, networkId);
        for (const item of [...supplied.values()].sort((left, right) =>
          compareEventOrder(left.event, right.event),
        )) {
          await this.#applyInTransaction(sql, item.event, item.manifest, true);
        }
      });
    } catch (error) {
      throw projectionError(error);
    }
  }

  async #applyInTransaction(
    sql: TransactionSql,
    event: ProtocolEvent,
    manifest: VerifiedManifest | undefined,
    rebuilding: boolean,
  ): Promise<boolean> {
    const inserted = await sql`
      INSERT INTO protocol_events (
        network_id, transaction_signature, transaction_index, log_index, slot,
        block_time, event_type, event_body
      ) VALUES (
        ${event.networkId}, ${event.transactionSignature},
        ${event.transactionIndex ?? null}, ${event.logIndex},
        ${event.slot.toString()}, ${event.blockTime}, ${event.type},
        ${sql.json(serializeEvent(event))}
      )
      ON CONFLICT DO NOTHING
      RETURNING event_type
    `;
    if (inserted.length === 0) {
      const exact = await sql`
        SELECT 1
        FROM protocol_events
        WHERE network_id = ${event.networkId}
          AND transaction_signature = ${event.transactionSignature}
          AND log_index = ${event.logIndex}
          AND transaction_index IS NOT DISTINCT FROM ${event.transactionIndex ?? null}
          AND slot = ${event.slot.toString()}
          AND block_time = ${event.blockTime}
          AND event_type = ${event.type}
          AND event_body = ${sql.json(serializeEvent(event))}
      `;
      if (exact.length !== 1) {
        throw eventConflict();
      }
      if (!rebuilding) {
        return false;
      }
    }

    switch (event.type) {
      case 'protocol-initialized': {
        await sql`
              INSERT INTO protocol_configs (
                network_id, config_address, initialized_slot, initialized_at
              ) VALUES (
                ${event.networkId}, ${event.configAddress},
                ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (network_id) DO NOTHING
            `;
        break;
      }
      case 'identity-created': {
        await sql`
              INSERT INTO identities (
                identity_id, network_id, identity_address, root_authority,
                root_rotation_count, created_slot, created_at, updated_slot, updated_at
              ) VALUES (
                ${event.identityId}, ${event.networkId}, ${event.identityAddress},
                ${event.rootAuthority}, 0, ${event.slot.toString()}, ${event.blockTime},
                ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (identity_id) DO NOTHING
            `;
        await sql`
              INSERT INTO root_authority_history (
                identity_id, rotation_count, authority, from_slot,
                from_transaction_index, from_transaction_signature, from_log_index
              ) VALUES (
                ${event.identityId}, 0, ${event.rootAuthority}, ${event.slot.toString()},
                ${event.transactionIndex ?? null}, ${event.transactionSignature}, ${event.logIndex}
              )
              ON CONFLICT DO NOTHING
            `;
        break;
      }
      case 'handle-claimed': {
        const identity = await sql<{ root_authority: string }[]>`
              SELECT root_authority
              FROM identities
              WHERE identity_id = ${event.identityId}
                AND network_id = ${event.networkId}
            `;
        if (identity[0] === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        if (identity[0].root_authority !== event.authority) {
          throw stale('Handle event authority does not match the current identity root authority.');
        }

        const existing = await sql<HandleRow[]>`
              SELECT *
              FROM handle_claims
              WHERE network_id = ${event.networkId}
                AND (
                  handle_claim_address = ${event.handleClaimAddress}
                  OR handle = ${event.handle}
                )
              FOR UPDATE
            `;
        if (existing.length > 1 || existing.some((row) => row.active)) {
          throw stale('Handle name or claim address is already active.');
        }
        const current = existing[0];
        if (
          current !== undefined &&
          (current.handle_claim_address !== event.handleClaimAddress ||
            current.handle !== event.handle ||
            current.handle_hash !== event.handleHash)
        ) {
          throw stale('Handle reclaim does not match the released claim address and digest.');
        }
        if (
          current !== undefined &&
          ((current.released_slot !== null && event.slot < BigInt(current.released_slot)) ||
            (current.identity_id === event.identityId &&
              event.identitySequence <= BigInt(current.identity_sequence)))
        ) {
          throw stale('Handle reclaim does not advance the released claim state.');
        }

        if (current === undefined) {
          await sql`
                INSERT INTO handle_claims (
                  network_id, handle_claim_address, handle, handle_hash,
                  identity_id, authority, identity_sequence, active,
                  claimed_slot, claimed_at, released_slot, released_at
                ) VALUES (
                  ${event.networkId}, ${event.handleClaimAddress}, ${event.handle},
                  ${event.handleHash}, ${event.identityId}, ${event.authority},
                  ${event.identitySequence.toString()}, true,
                  ${event.slot.toString()}, ${event.blockTime}, null, null
                )
              `;
        } else {
          const updated = await sql`
                UPDATE handle_claims
                SET identity_id = ${event.identityId},
                    authority = ${event.authority},
                    identity_sequence = ${event.identitySequence.toString()},
                    active = true,
                    claimed_slot = ${event.slot.toString()},
                    claimed_at = ${event.blockTime},
                    released_slot = null,
                    released_at = null
                WHERE network_id = ${event.networkId}
                  AND handle_claim_address = ${event.handleClaimAddress}
                  AND NOT active
                RETURNING handle_claim_address
              `;
          if (updated.length !== 1) {
            throw stale('Released handle could not be reclaimed.');
          }
        }
        break;
      }
      case 'handle-released': {
        const identity = await sql<{ root_authority: string }[]>`
              SELECT root_authority
              FROM identities
              WHERE identity_id = ${event.identityId}
                AND network_id = ${event.networkId}
            `;
        if (identity[0] === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        if (identity[0].root_authority !== event.authority) {
          throw stale('Handle event authority does not match the current identity root authority.');
        }

        const updated = await sql`
              UPDATE handle_claims
              SET authority = ${event.authority},
                  identity_sequence = ${event.identitySequence.toString()},
                  active = false,
                  released_slot = ${event.slot.toString()},
                  released_at = ${event.blockTime}
              WHERE network_id = ${event.networkId}
                AND handle_claim_address = ${event.handleClaimAddress}
                AND handle = ${event.handle}
                AND handle_hash = ${event.handleHash}
                AND identity_id = ${event.identityId}
                AND active
                AND claimed_slot <= ${event.slot.toString()}
                AND identity_sequence < ${event.identitySequence.toString()}
              RETURNING handle_claim_address
            `;
        if (updated.length !== 1) {
          throw stale('Handle release does not exactly match the active indexed claim.');
        }
        break;
      }
      case 'root-authority-rotated': {
        const updated = await sql`
              UPDATE identities
              SET root_authority = ${event.newRootAuthority},
                  root_rotation_count = ${event.rotationCount.toString()},
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE identity_id = ${event.identityId}
                AND root_authority = ${event.previousRootAuthority}
                AND root_rotation_count + 1 = ${event.rotationCount.toString()}
              RETURNING identity_id
            `;
        if (updated.length !== 1) {
          throw stale('Root rotation does not continue the indexed authority epoch.');
        }
        await sql`
              INSERT INTO root_authority_history (
                identity_id, rotation_count, authority, from_slot,
                from_transaction_index, from_transaction_signature, from_log_index
              ) VALUES (
                ${event.identityId}, ${event.rotationCount.toString()},
                ${event.newRootAuthority}, ${event.slot.toString()},
                ${event.transactionIndex ?? null}, ${event.transactionSignature}, ${event.logIndex}
              )
            `;
        break;
      }
      case 'delegation-created': {
        const identity = await sql<{ root_rotation_count: string }[]>`
              SELECT root_rotation_count
              FROM identities
              WHERE identity_id = ${event.identityId}
            `;
        if (
          identity[0] === undefined ||
          BigInt(identity[0].root_rotation_count) !== event.issuedAtRootRotationCount
        ) {
          throw stale('Delegation was issued for a non-current root rotation epoch.');
        }
        await sql`
              INSERT INTO delegations (
                delegation_address, network_id, identity_id, delegate_authority,
                delegation_sequence, identity_sequence, scopes,
                issued_at_root_rotation_count, issued_at_slot, expires_at_slot,
                state_sequence, created_transaction_index,
                created_transaction_signature, created_log_index, updated_at
              ) VALUES (
                ${event.delegationAddress}, ${event.networkId}, ${event.identityId},
                ${event.delegateAuthority},
                ${event.delegationSequence.toString()}, ${event.identitySequence.toString()},
                ${event.scopes}, ${event.issuedAtRootRotationCount.toString()},
                ${event.slot.toString()}, ${event.expiresAtSlot.toString()}, 1,
                ${event.transactionIndex ?? null}, ${event.transactionSignature},
                ${event.logIndex}, ${event.blockTime}
              )
            `;
        break;
      }
      case 'delegation-revoked': {
        const updated = await sql`
              UPDATE delegations
              SET identity_sequence = ${event.identitySequence.toString()},
                  state_sequence = ${event.delegationStateSequence.toString()},
                  revoked_at_slot = ${event.slot.toString()},
                  revoked_transaction_index = ${event.transactionIndex ?? null},
                  revoked_transaction_signature = ${event.transactionSignature},
                  revoked_log_index = ${event.logIndex},
                  updated_at = ${event.blockTime}
              WHERE delegation_address = ${event.delegationAddress}
                AND network_id = ${event.networkId}
                AND identity_id = ${event.identityId}
                AND delegate_authority = ${event.delegateAuthority}
                AND delegation_sequence = ${event.delegationSequence.toString()}
                AND revoked_at_slot IS NULL
                AND state_sequence < ${event.delegationStateSequence.toString()}
              RETURNING delegation_address
            `;
        if (updated.length !== 1) {
          throw stale('Delegation revocation does not continue the indexed delegation state.');
        }
        break;
      }
      case 'profile-updated': {
        const verified = requireManifest(event, manifest, 'profile');
        const content = verified.content as ProfileProjection['content'];
        const updated = await sql`
              INSERT INTO profiles (
                identity_id, object_id, cid, payload_hash, display_name, bio,
                pronouns, updated_slot, updated_at
              ) VALUES (
                ${event.identityId}, ${verified.objectId}, ${verified.cid},
                ${verified.payloadHash}, ${content.displayName}, ${content.bio},
                ${sql.json(content.pronouns)}, ${event.slot.toString()},
                ${event.blockTime}
              )
              ON CONFLICT (identity_id) DO UPDATE SET
                object_id = EXCLUDED.object_id,
                cid = EXCLUDED.cid,
                payload_hash = EXCLUDED.payload_hash,
                display_name = EXCLUDED.display_name,
                bio = EXCLUDED.bio,
                pronouns = EXCLUDED.pronouns,
                updated_slot = EXCLUDED.updated_slot,
                updated_at = EXCLUDED.updated_at
              WHERE profiles.updated_slot < EXCLUDED.updated_slot
              RETURNING identity_id
            `;
        if (updated.length !== 1) {
          throw stale('Profile event is older than the current projection.');
        }
        break;
      }
      case 'post-published': {
        const verified = requireManifest(event, manifest, 'post');
        const content = verified.content as PostProjection['content'];
        await sql`
              INSERT INTO posts (
                object_id, network_id, author_identity_id, cid, payload_hash,
                signing_key_id, body, language, content, created_at,
                anchored_slot, transaction_signature, verified
              ) VALUES (
                ${verified.objectId}, ${event.networkId}, ${event.identityId},
                ${verified.cid}, ${verified.payloadHash}, ${verified.signingKeyId},
                ${content.body ?? null}, ${content.language}, ${sql.json(content)},
                ${verified.createdAt}, ${event.slot.toString()},
                ${event.transactionSignature}, true
              )
              ON CONFLICT (object_id) DO NOTHING
            `;
        break;
      }
      case 'follow-changed': {
        const updated = await sql`
              INSERT INTO follows (
                follower_identity_id, followed_identity_id, active,
                state_sequence, updated_slot, updated_at
              ) VALUES (
                ${event.followerIdentityId}, ${event.followedIdentityId},
                ${event.active}, ${event.sequence.toString()},
                ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (follower_identity_id, followed_identity_id)
              DO UPDATE SET
                active = EXCLUDED.active,
                state_sequence = EXCLUDED.state_sequence,
                updated_slot = EXCLUDED.updated_slot,
                updated_at = EXCLUDED.updated_at
              WHERE follows.state_sequence < EXCLUDED.state_sequence
              RETURNING follower_identity_id
            `;
        if (updated.length !== 1) {
          throw stale('Follow event does not advance its state sequence.');
        }
        break;
      }
      case 'block-changed': {
        const updated = await sql`
              INSERT INTO blocks (
                network_id, blocker_identity_id, subject_identity_id, block_edge_address,
                authority, blocker_sequence, state_sequence, active,
                updated_slot, updated_at
              ) VALUES (
                ${event.networkId}, ${event.blockerIdentityId}, ${event.subjectIdentityId},
                ${event.blockEdgeAddress}, ${event.authority},
                ${event.blockerSequence.toString()}, ${event.edgeStateSequence.toString()},
                ${event.active}, ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (blocker_identity_id, subject_identity_id)
              DO UPDATE SET
                block_edge_address = EXCLUDED.block_edge_address,
                authority = EXCLUDED.authority,
                blocker_sequence = EXCLUDED.blocker_sequence,
                state_sequence = EXCLUDED.state_sequence,
                active = EXCLUDED.active,
                updated_slot = EXCLUDED.updated_slot,
                updated_at = EXCLUDED.updated_at
              WHERE blocks.state_sequence < EXCLUDED.state_sequence
              RETURNING blocker_identity_id
            `;
        if (updated.length !== 1) {
          throw stale('Block event does not advance its state sequence.');
        }
        break;
      }
      case 'tombstoned':
        if (event.cid !== undefined) {
          requireManifest(event, manifest, 'tombstone');
        }
        await sql`
              UPDATE posts
              SET tombstoned_at = ${event.blockTime}
              WHERE object_id = ${event.targetObjectId}
                AND author_identity_id = ${event.identityId}
            `;
        break;
      case 'community-created':
        await sql`
              INSERT INTO communities (
                community_address, network_id, creator_identity_id, authority,
                creator_sequence, manifest_cid, manifest_hash, manifest_verified,
                governance_version, governance_strategy_hash,
                created_slot, created_at, updated_slot, updated_at
              ) VALUES (
                ${event.communityAddress}, ${event.networkId}, ${event.creatorIdentityId},
                ${event.authority}, ${event.creatorSequence.toString()},
                ${event.manifestCid}, ${event.manifestHash}, false,
                ${event.governanceVersion}, ${event.governanceStrategyHash},
                ${event.slot.toString()}, ${event.blockTime},
                ${event.slot.toString()}, ${event.blockTime}
              )
            `;
        await sql`
              INSERT INTO community_governance_history (
                network_id, community_address, governance_version, strategy_hash,
                authority, creator_sequence, updated_slot, updated_at
              ) VALUES (
                ${event.networkId}, ${event.communityAddress}, ${event.governanceVersion},
                ${event.governanceStrategyHash}, ${event.authority},
                ${event.creatorSequence.toString()}, ${event.slot.toString()},
                ${event.blockTime}
              )
            `;
        break;
      case 'community-governance-updated': {
        const updated = await sql`
              UPDATE communities
              SET authority = ${event.authority},
                  creator_sequence = ${event.creatorSequence.toString()},
                  governance_version = ${event.governanceVersion},
                  governance_strategy_hash = ${event.governanceStrategyHash},
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE community_address = ${event.communityAddress}
                AND network_id = ${event.networkId}
                AND creator_identity_id = ${event.creatorIdentityId}
                AND governance_version = ${event.previousGovernanceVersion}
                AND governance_strategy_hash = ${event.previousStrategyHash}
                AND creator_sequence < ${event.creatorSequence.toString()}
              RETURNING community_address
            `;
        if (updated.length !== 1) {
          throw stale('Community governance event does not continue the indexed strategy.');
        }
        await sql`
              INSERT INTO community_governance_history (
                network_id, community_address, governance_version, strategy_hash,
                authority, creator_sequence, updated_slot, updated_at
              ) VALUES (
                ${event.networkId}, ${event.communityAddress}, ${event.governanceVersion},
                ${event.governanceStrategyHash}, ${event.authority},
                ${event.creatorSequence.toString()}, ${event.slot.toString()},
                ${event.blockTime}
              )
            `;
        break;
      }
      case 'community-membership-changed': {
        const communities = await sql<CommunityRow[]>`
              SELECT *
              FROM communities
              WHERE network_id = ${event.networkId}
                AND community_address = ${event.communityAddress}
              FOR UPDATE
            `;
        const community = communities[0];
        if (community === undefined) {
          throw new ProjectionError(
            `Community ${event.communityAddress} has not been indexed.`,
            'missing-identity',
          );
        }
        if (
          community.network_id !== event.networkId ||
          community.creator_identity_id !== event.assignedByIdentityId ||
          event.authoritySequence <= BigInt(community.creator_sequence)
        ) {
          throw stale('Membership event authority does not advance the indexed community.');
        }
        const existingMemberships = await sql<CommunityMembershipRow[]>`
              SELECT *
              FROM community_memberships
              WHERE network_id = ${event.networkId}
                AND (
                  (
                    community_address = ${event.communityAddress}
                    AND member_identity_id = ${event.memberIdentityId}
                  )
                  OR membership_address = ${event.membershipAddress}
                )
              FOR UPDATE
            `;
        const current = existingMemberships.find(
          (membership) =>
            membership.community_address === event.communityAddress &&
            membership.member_identity_id === event.memberIdentityId,
        );
        if (
          (current !== undefined &&
            (event.membershipStateSequence <= BigInt(current.state_sequence) ||
              current.membership_address !== event.membershipAddress)) ||
          existingMemberships.some((membership) => membership !== current)
        ) {
          throw stale('Membership event does not advance its exact indexed account.');
        }
        const updated = await sql`
              INSERT INTO community_memberships (
                network_id, community_address, member_identity_id, membership_address,
                assigned_by_identity_id, authority, authority_sequence,
                state_sequence, roles, active, updated_slot, updated_at
              ) VALUES (
                ${event.networkId}, ${event.communityAddress}, ${event.memberIdentityId},
                ${event.membershipAddress}, ${event.assignedByIdentityId},
                ${event.authority}, ${event.authoritySequence.toString()},
                ${event.membershipStateSequence.toString()}, ${event.roles},
                ${event.active}, ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (network_id, community_address, member_identity_id)
              DO UPDATE SET
                membership_address = EXCLUDED.membership_address,
                assigned_by_identity_id = EXCLUDED.assigned_by_identity_id,
                authority = EXCLUDED.authority,
                authority_sequence = EXCLUDED.authority_sequence,
                state_sequence = EXCLUDED.state_sequence,
                roles = EXCLUDED.roles,
                active = EXCLUDED.active,
                updated_slot = EXCLUDED.updated_slot,
                updated_at = EXCLUDED.updated_at
              WHERE community_memberships.state_sequence < EXCLUDED.state_sequence
              RETURNING community_address
            `;
        if (updated.length !== 1) {
          throw stale('Membership event does not advance its state sequence.');
        }
        const advanced = await sql`
              UPDATE communities
              SET authority = ${event.authority},
                  creator_sequence = ${event.authoritySequence.toString()},
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE community_address = ${event.communityAddress}
                AND network_id = ${event.networkId}
                AND creator_sequence < ${event.authoritySequence.toString()}
              RETURNING community_address
            `;
        if (advanced.length !== 1) {
          throw stale('Membership event could not advance the community sequence.');
        }
        break;
      }
      case 'reaction-changed': {
        const target = await sql`
              SELECT 1
              FROM protocol_events
              WHERE network_id = ${event.networkId}
                AND event_type = 'post-published'
                AND event_body ->> 'postReference' = ${event.targetPostReference}
              LIMIT 1
            `;
        if (target.length !== 1) {
          throw new ProjectionError(
            `Post reference ${event.targetPostReference} has not been indexed.`,
            'missing-identity',
          );
        }
        const updated = await sql`
              INSERT INTO reactions (
                network_id, reactor_identity_id, target_post_reference,
                reaction_kind, reaction_reference, authority, reactor_sequence,
                state_sequence, active, updated_slot, updated_at
              ) VALUES (
                ${event.networkId}, ${event.reactorIdentityId},
                ${event.targetPostReference}, ${event.reactionKind},
                ${event.reactionReference}, ${event.authority},
                ${event.reactorSequence.toString()},
                ${event.reactionStateSequence.toString()}, ${event.active},
                ${event.slot.toString()}, ${event.blockTime}
              )
              ON CONFLICT (
                network_id, reactor_identity_id, target_post_reference, reaction_kind
              )
              DO UPDATE SET
                reaction_reference = EXCLUDED.reaction_reference,
                authority = EXCLUDED.authority,
                reactor_sequence = EXCLUDED.reactor_sequence,
                state_sequence = EXCLUDED.state_sequence,
                active = EXCLUDED.active,
                updated_slot = EXCLUDED.updated_slot,
                updated_at = EXCLUDED.updated_at
              WHERE reactions.state_sequence < EXCLUDED.state_sequence
              RETURNING reaction_reference
            `;
        if (updated.length !== 1) {
          throw stale('Reaction event does not advance its state sequence.');
        }
        break;
      }
      case 'recovery-policy-configured': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const policies = await sql<RecoveryPolicyRow[]>`
              SELECT *
              FROM recovery_policies
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const current = policies[0];
        const latestSequences = await sql<LatestSequenceRow[]>`
              SELECT max(identity_sequence)::text AS identity_sequence
              FROM (
                SELECT identity_sequence
                FROM recovery_policies
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT terminal_identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                  AND terminal_identity_sequence IS NOT NULL
              ) AS recovery_identity_sequences
            `;
        const latestSequence = BigInt(latestSequences[0]?.identity_sequence ?? '0');
        const expectedPolicyAddress = await deriveRecoveryPolicyAddress(
          event.programId,
          identity.identity_address,
        );
        if (
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== event.rootAuthority ||
          BigInt(identity.root_rotation_count) !== event.rootRotationCount ||
          event.recoveryPolicyAddress !== expectedPolicyAddress ||
          event.policySequence !== BigInt(current?.policy_sequence ?? '0') + 1n ||
          event.identitySequence <= latestSequence ||
          (current !== undefined &&
            (current.network_id !== event.networkId ||
              current.recovery_policy_address !== event.recoveryPolicyAddress))
        ) {
          throw stale('Recovery policy event does not continue the indexed identity and policy.');
        }
        if (current === undefined) {
          await sql`
                INSERT INTO recovery_policies (
                  recovery_policy_address, network_id, identity_id, root_authority,
                  policy_sequence, identity_sequence, root_rotation_count, guardians,
                  threshold, delay_slots, active, updated_slot, updated_at
                ) VALUES (
                  ${event.recoveryPolicyAddress}, ${event.networkId}, ${event.identityId},
                  ${event.rootAuthority}, ${event.policySequence.toString()},
                  ${event.identitySequence.toString()}, ${event.rootRotationCount.toString()},
                  ${sql.json([...event.guardians])}, ${event.threshold},
                  ${event.delaySlots.toString()}, true, ${event.slot.toString()},
                  ${event.blockTime}
                )
              `;
        } else {
          const updated = await sql`
                UPDATE recovery_policies
                SET root_authority = ${event.rootAuthority},
                    policy_sequence = ${event.policySequence.toString()},
                    identity_sequence = ${event.identitySequence.toString()},
                    root_rotation_count = ${event.rootRotationCount.toString()},
                    guardians = ${sql.json([...event.guardians])},
                    threshold = ${event.threshold},
                    delay_slots = ${event.delaySlots.toString()},
                    active = true,
                    updated_slot = ${event.slot.toString()},
                    updated_at = ${event.blockTime}
                WHERE identity_id = ${event.identityId}
                  AND recovery_policy_address = ${event.recoveryPolicyAddress}
                  AND policy_sequence + 1 = ${event.policySequence.toString()}
                RETURNING recovery_policy_address
              `;
          if (updated.length !== 1) {
            throw stale('Recovery policy could not advance its indexed sequence.');
          }
        }
        break;
      }
      case 'recovery-policy-disabled': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const policies = await sql<RecoveryPolicyRow[]>`
              SELECT *
              FROM recovery_policies
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const policy = policies[0];
        const latestSequences = await sql<LatestSequenceRow[]>`
              SELECT max(identity_sequence)::text AS identity_sequence
              FROM (
                SELECT identity_sequence
                FROM recovery_policies
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT terminal_identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                  AND terminal_identity_sequence IS NOT NULL
              ) AS recovery_identity_sequences
            `;
        const latestSequence = BigInt(latestSequences[0]?.identity_sequence ?? '0');
        if (
          policy === undefined ||
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== event.rootAuthority ||
          BigInt(identity.root_rotation_count) !== event.rootRotationCount ||
          policy.network_id !== event.networkId ||
          policy.recovery_policy_address !== event.recoveryPolicyAddress ||
          !policy.active ||
          event.policySequence !== BigInt(policy.policy_sequence) + 1n ||
          event.identitySequence <= latestSequence
        ) {
          throw stale('Recovery policy disable does not continue the active indexed policy.');
        }
        const updated = await sql`
              UPDATE recovery_policies
              SET root_authority = ${event.rootAuthority},
                  policy_sequence = ${event.policySequence.toString()},
                  identity_sequence = ${event.identitySequence.toString()},
                  root_rotation_count = ${event.rootRotationCount.toString()},
                  active = false,
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE identity_id = ${event.identityId}
                AND recovery_policy_address = ${event.recoveryPolicyAddress}
                AND active
                AND policy_sequence + 1 = ${event.policySequence.toString()}
              RETURNING recovery_policy_address
            `;
        if (updated.length !== 1) {
          throw stale('Recovery policy could not be disabled.');
        }
        break;
      }
      case 'recovery-requested': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const policies = await sql<RecoveryPolicyRow[]>`
              SELECT *
              FROM recovery_policies
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const policy = policies[0];
        const latestSequences = await sql<LatestSequenceRow[]>`
              SELECT max(identity_sequence)::text AS identity_sequence
              FROM (
                SELECT identity_sequence
                FROM recovery_policies
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT terminal_identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                  AND terminal_identity_sequence IS NOT NULL
              ) AS recovery_identity_sequences
            `;
        const latestSequence = BigInt(latestSequences[0]?.identity_sequence ?? '0');
        const guardians = policy?.guardians ?? [];
        const guardianIndex = guardians.indexOf(event.requestingGuardian);
        const expectedRequestAddress = await deriveRecoveryRequestAddress(
          event.programId,
          identity.identity_address,
          Uint8Array.from(Buffer.from(event.requestNonce, 'hex')),
        );
        const duplicate = await sql`
              SELECT 1
              FROM recovery_requests
              WHERE network_id = ${event.networkId}
                AND (
                  recovery_request_address = ${event.recoveryRequestAddress}
                  OR (
                    identity_id = ${event.identityId}
                    AND request_nonce = ${event.requestNonce}
                  )
                )
              LIMIT 1
            `;
        if (
          policy === undefined ||
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== event.currentRootAuthority ||
          BigInt(identity.root_rotation_count) !== event.rootRotationCount ||
          policy.network_id !== event.networkId ||
          policy.recovery_policy_address !== event.recoveryPolicyAddress ||
          !policy.active ||
          BigInt(policy.policy_sequence) !== event.policySequence ||
          policy.threshold !== event.threshold ||
          guardians.length !== event.guardianCount ||
          event.executeAfterSlot !== event.slot + BigInt(policy.delay_slots) ||
          event.identitySequence < latestSequence ||
          guardians.includes(event.currentRootAuthority) ||
          guardianIndex < 0 ||
          event.recoveryRequestAddress !== expectedRequestAddress ||
          duplicate.length !== 0
        ) {
          throw stale('Recovery request does not match the active indexed policy snapshot.');
        }
        await sql`
              INSERT INTO recovery_requests (
                recovery_request_address, network_id, identity_id,
                recovery_policy_address, request_nonce, policy_sequence,
                current_root_authority, identity_sequence, root_rotation_count,
                target_root_authority, requesting_guardian, guardians, threshold,
                guardian_count, approvals_mask, approved_guardians, approval_count,
                requested_slot, requested_at, execute_after_slot, state,
                updated_slot, updated_at
              ) VALUES (
                ${event.recoveryRequestAddress}, ${event.networkId}, ${event.identityId},
                ${event.recoveryPolicyAddress}, ${event.requestNonce},
                ${event.policySequence.toString()}, ${event.currentRootAuthority},
                ${event.identitySequence.toString()}, ${event.rootRotationCount.toString()},
                ${event.targetRootAuthority}, ${event.requestingGuardian},
                ${sql.json([...guardians])}, ${event.threshold}, ${event.guardianCount},
                ${1 << guardianIndex}, ${sql.json([event.requestingGuardian])},
                ${event.approvalCount}, ${event.slot.toString()}, ${event.blockTime},
                ${event.executeAfterSlot.toString()}, 'pending',
                ${event.slot.toString()}, ${event.blockTime}
              )
            `;
        break;
      }
      case 'recovery-approved': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const policies = await sql<RecoveryPolicyRow[]>`
              SELECT *
              FROM recovery_policies
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const requests = await sql<RecoveryRequestRow[]>`
              SELECT *
              FROM recovery_requests
              WHERE network_id = ${event.networkId}
                AND recovery_request_address = ${event.recoveryRequestAddress}
              FOR UPDATE
            `;
        const policy = policies[0];
        const request = requests[0];
        const guardianBit = 1 << event.guardianIndex;
        if (
          policy === undefined ||
          request === undefined ||
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== request.current_root_authority ||
          BigInt(identity.root_rotation_count) !== BigInt(request.root_rotation_count) ||
          policy.network_id !== event.networkId ||
          policy.recovery_policy_address !== event.recoveryPolicyAddress ||
          !policy.active ||
          BigInt(policy.policy_sequence) !== event.policySequence ||
          request.network_id !== event.networkId ||
          request.identity_id !== event.identityId ||
          request.recovery_policy_address !== event.recoveryPolicyAddress ||
          BigInt(request.policy_sequence) !== event.policySequence ||
          request.state !== 'pending' ||
          request.threshold !== event.threshold ||
          event.guardianIndex >= request.guardians.length ||
          request.guardians[event.guardianIndex] !== event.guardian ||
          (request.approvals_mask & guardianBit) !== 0 ||
          event.approvalCount !== request.approval_count + 1
        ) {
          throw stale('Recovery approval does not advance the indexed request exactly once.');
        }
        const approvedGuardians = [...request.approved_guardians, event.guardian];
        const updated = await sql`
              UPDATE recovery_requests
              SET approvals_mask = ${request.approvals_mask | guardianBit},
                  approved_guardians = ${sql.json(approvedGuardians)},
                  approval_count = ${event.approvalCount},
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE recovery_request_address = ${event.recoveryRequestAddress}
                AND network_id = ${event.networkId}
                AND state = 'pending'
                AND approval_count + 1 = ${event.approvalCount}
                AND (approvals_mask & ${guardianBit}) = 0
              RETURNING recovery_request_address
            `;
        if (updated.length !== 1) {
          throw stale('Recovery approval could not advance the request.');
        }
        break;
      }
      case 'recovery-cancelled': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const requests = await sql<RecoveryRequestRow[]>`
              SELECT *
              FROM recovery_requests
              WHERE network_id = ${event.networkId}
                AND recovery_request_address = ${event.recoveryRequestAddress}
              FOR UPDATE
            `;
        const request = requests[0];
        const latestSequences = await sql<LatestSequenceRow[]>`
              SELECT max(identity_sequence)::text AS identity_sequence
              FROM (
                SELECT identity_sequence
                FROM recovery_policies
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT terminal_identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                  AND terminal_identity_sequence IS NOT NULL
              ) AS recovery_identity_sequences
            `;
        const latestSequence = BigInt(latestSequences[0]?.identity_sequence ?? '0');
        if (
          request === undefined ||
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== event.cancelledByRootAuthority ||
          BigInt(identity.root_rotation_count) !== event.rootRotationCount ||
          request.network_id !== event.networkId ||
          request.identity_id !== event.identityId ||
          request.recovery_policy_address !== event.recoveryPolicyAddress ||
          BigInt(request.policy_sequence) !== event.policySequence ||
          request.target_root_authority !== event.targetRootAuthority ||
          request.state !== 'pending' ||
          event.identitySequence <= latestSequence
        ) {
          throw stale('Recovery cancellation does not close the indexed pending request.');
        }
        const updated = await sql`
              UPDATE recovery_requests
              SET state = 'cancelled',
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime},
                  terminal_identity_sequence = ${event.identitySequence.toString()},
                  terminal_root_rotation_count = ${event.rootRotationCount.toString()},
                  terminal_slot = ${event.slot.toString()},
                  terminal_at = ${event.blockTime},
                  cancelled_by_root_authority = ${event.cancelledByRootAuthority}
              WHERE recovery_request_address = ${event.recoveryRequestAddress}
                AND network_id = ${event.networkId}
                AND state = 'pending'
              RETURNING recovery_request_address
            `;
        if (updated.length !== 1) {
          throw stale('Recovery request could not be cancelled.');
        }
        break;
      }
      case 'recovery-executed': {
        const identities = await sql<IdentityRow[]>`
              SELECT *
              FROM identities
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const identity = identities[0];
        if (identity === undefined) {
          throw new ProjectionError(
            `Identity ${event.identityId} has not been indexed.`,
            'missing-identity',
          );
        }
        const policies = await sql<RecoveryPolicyRow[]>`
              SELECT *
              FROM recovery_policies
              WHERE identity_id = ${event.identityId}
              FOR UPDATE
            `;
        const requests = await sql<RecoveryRequestRow[]>`
              SELECT *
              FROM recovery_requests
              WHERE network_id = ${event.networkId}
                AND recovery_request_address = ${event.recoveryRequestAddress}
              FOR UPDATE
            `;
        const rootEvents = await sql<ProtocolEventRow[]>`
              SELECT event_type, event_body, slot, transaction_index, log_index
              FROM protocol_events
              WHERE network_id = ${event.networkId}
                AND transaction_signature = ${event.transactionSignature}
                AND log_index < ${event.logIndex}
              ORDER BY log_index DESC
              LIMIT 1
            `;
        const latestSequences = await sql<LatestSequenceRow[]>`
              SELECT max(identity_sequence)::text AS identity_sequence
              FROM (
                SELECT identity_sequence
                FROM recovery_policies
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                UNION ALL
                SELECT terminal_identity_sequence
                FROM recovery_requests
                WHERE identity_id = ${event.identityId}
                  AND terminal_identity_sequence IS NOT NULL
              ) AS recovery_identity_sequences
            `;
        const policy = policies[0];
        const request = requests[0];
        const rootEvent = rootEvents[0];
        const latestSequence = BigInt(latestSequences[0]?.identity_sequence ?? '0');
        if (
          policy === undefined ||
          request === undefined ||
          rootEvent === undefined ||
          identity.network_id !== event.networkId ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          identity.root_authority !== event.newRootAuthority ||
          BigInt(identity.root_rotation_count) !== event.rotationCount ||
          policy.network_id !== event.networkId ||
          policy.recovery_policy_address !== event.recoveryPolicyAddress ||
          !policy.active ||
          BigInt(policy.policy_sequence) !== event.policySequence ||
          request.network_id !== event.networkId ||
          request.identity_id !== event.identityId ||
          request.recovery_policy_address !== event.recoveryPolicyAddress ||
          BigInt(request.policy_sequence) !== event.policySequence ||
          request.current_root_authority !== event.previousRootAuthority ||
          request.target_root_authority !== event.newRootAuthority ||
          request.state !== 'pending' ||
          request.threshold !== event.threshold ||
          request.approval_count !== event.approvalCount ||
          event.approvalCount < event.threshold ||
          event.identitySequence !== BigInt(request.identity_sequence) + 1n ||
          event.identitySequence <= latestSequence ||
          event.rotationCount !== BigInt(request.root_rotation_count) + 1n ||
          event.slot < BigInt(request.execute_after_slot) ||
          rootEvent.event_type !== 'root-authority-rotated' ||
          BigInt(rootEvent.slot) !== event.slot ||
          rootEvent.transaction_index !== (event.transactionIndex ?? null) ||
          rootEvent.event_body.programId !== event.programId ||
          rootEvent.event_body.identityId !== event.identityId ||
          rootEvent.event_body.previousRootAuthority !== event.previousRootAuthority ||
          rootEvent.event_body.newRootAuthority !== event.newRootAuthority ||
          rootEvent.event_body.identitySequence !== event.identitySequence.toString() ||
          rootEvent.event_body.rotationCount !== event.rotationCount.toString()
        ) {
          throw stale('Recovery execution does not close an eligible indexed pending request.');
        }
        const updated = await sql`
              UPDATE recovery_requests
              SET state = 'executed',
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime},
                  terminal_identity_sequence = ${event.identitySequence.toString()},
                  terminal_root_rotation_count = ${event.rotationCount.toString()},
                  terminal_slot = ${event.slot.toString()},
                  terminal_at = ${event.blockTime},
                  executor = ${event.executor}
              WHERE recovery_request_address = ${event.recoveryRequestAddress}
                AND network_id = ${event.networkId}
                AND state = 'pending'
              RETURNING recovery_request_address
            `;
        if (updated.length !== 1) {
          throw stale('Recovery request could not be executed.');
        }
        break;
      }
      case 'proposal-created': {
        const communities = await sql<CommunityRow[]>`
              SELECT *
              FROM communities
              WHERE network_id = ${event.networkId}
                AND community_address = ${event.communityAddress}
              FOR UPDATE
            `;
        const community = communities[0];
        if (community === undefined) {
          throw new ProjectionError(
            `Community ${event.communityAddress} has not been indexed.`,
            'missing-identity',
          );
        }
        const proposers = await sql<{ network_id: string }[]>`
              SELECT network_id
              FROM identities
              WHERE identity_id = ${event.proposerIdentityId}
            `;
        if (proposers[0] === undefined) {
          throw new ProjectionError(
            `Identity ${event.proposerIdentityId} has not been indexed.`,
            'missing-identity',
          );
        }
        if (
          proposers[0].network_id !== event.networkId ||
          community.network_id !== event.networkId ||
          community.creator_identity_id !== event.proposerIdentityId ||
          !programMatchesNetwork(event.networkId, event.programId)
        ) {
          throw stale('Proposal proposer does not match the indexed community creator.');
        }
        if (
          event.previousCommunitySequence !== BigInt(community.creator_sequence) ||
          event.proposerSequence <= BigInt(community.creator_sequence)
        ) {
          throw stale('Proposal does not advance the indexed community sequence.');
        }
        if (
          event.governanceVersion !== community.governance_version ||
          event.governanceStrategyHash !== community.governance_strategy_hash
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
        const duplicate = await sql`
              SELECT 1
              FROM governance_proposals
              WHERE network_id = ${event.networkId}
                AND (
                  proposal_address = ${event.proposalAddress}
                  OR (
                    community_address = ${event.communityAddress}
                    AND manifest_hash = ${event.manifestHash}
                  )
                )
              LIMIT 1
            `;
        if (duplicate.length !== 0) {
          throw stale('Proposal address or community manifest was already projected.');
        }
        const counts = await sql<{ eligible_member_count: string }[]>`
              SELECT count(*)::text AS eligible_member_count
              FROM community_memberships
              WHERE network_id = ${event.networkId}
                AND community_address = ${event.communityAddress}
                AND active
                AND (roles & 1) = 1
            `;
        if (
          counts[0] === undefined ||
          event.eligibleMemberCount !== BigInt(counts[0].eligible_member_count)
        ) {
          throw stale('Proposal eligible-member count does not match the indexed membership set.');
        }
        await sql`
              INSERT INTO governance_proposals (
                proposal_address, network_id, community_address, proposer_identity_id,
                authority, proposer_sequence, previous_community_sequence,
                manifest_hash, manifest_uri, manifest_verified,
                governance_version, governance_strategy_hash, voting_model,
                eligible_member_count, opens_at_slot, closes_at_slot,
                quorum_bps, approval_bps, yes_votes, no_votes, abstain_votes,
                state_sequence, outcome, created_slot, created_at
              ) VALUES (
                ${event.proposalAddress}, ${event.networkId}, ${event.communityAddress},
                ${event.proposerIdentityId}, ${event.authority},
                ${event.proposerSequence.toString()},
                ${event.previousCommunitySequence.toString()},
                ${event.manifestHash}, ${event.manifestUri}, false,
                ${event.governanceVersion}, ${event.governanceStrategyHash},
                ${event.votingModel}, ${event.eligibleMemberCount.toString()},
                ${event.opensAtSlot.toString()}, ${event.closesAtSlot.toString()},
                ${event.quorumBps}, ${event.approvalBps}, 0, 0, 0,
                ${event.proposalStateSequence.toString()}, 'pending',
                ${event.slot.toString()}, ${event.blockTime}
              )
            `;
        const advanced = await sql`
              UPDATE communities
              SET authority = ${event.authority},
                  creator_sequence = ${event.proposerSequence.toString()},
                  updated_slot = ${event.slot.toString()},
                  updated_at = ${event.blockTime}
              WHERE community_address = ${event.communityAddress}
                AND network_id = ${event.networkId}
                AND creator_sequence = ${event.previousCommunitySequence.toString()}
              RETURNING community_address
            `;
        if (advanced.length !== 1) {
          throw stale('Proposal could not advance the indexed community sequence.');
        }
        break;
      }
      case 'vote-cast': {
        const proposals = await sql<GovernanceProposalRow[]>`
              SELECT *
              FROM governance_proposals
              WHERE network_id = ${event.networkId}
                AND proposal_address = ${event.proposalAddress}
              FOR UPDATE
            `;
        const proposal = proposals[0];
        if (
          proposal === undefined ||
          proposal.network_id !== event.networkId ||
          proposal.community_address !== event.communityAddress ||
          !programMatchesNetwork(event.networkId, event.programId)
        ) {
          throw stale('Vote proposal or community does not match indexed governance state.');
        }
        const voters = await sql<{ network_id: string; identity_address: string }[]>`
              SELECT network_id, identity_address
              FROM identities
              WHERE identity_id = ${event.voterIdentityId}
            `;
        if (voters[0] === undefined) {
          throw new ProjectionError(
            `Identity ${event.voterIdentityId} has not been indexed.`,
            'missing-identity',
          );
        }
        if (
          voters[0].network_id !== event.networkId ||
          proposal.outcome !== 'pending' ||
          event.slot < BigInt(proposal.opens_at_slot) ||
          event.slot >= BigInt(proposal.closes_at_slot)
        ) {
          throw stale('Vote is not eligible for the indexed proposal voting window.');
        }
        const expectedVoteAddress = await deriveGovernanceVoteAddress(
          event.programId,
          event.proposalAddress,
          voters[0].identity_address,
        );
        if (event.voteAddress !== expectedVoteAddress) {
          throw stale('Vote address is not the canonical governance PDA.');
        }
        const expectedMembershipAddress = await deriveCommunityMembershipAddress(
          event.programId,
          event.communityAddress,
          voters[0].identity_address,
        );
        if (event.membershipAddress !== expectedMembershipAddress) {
          throw stale('Vote membership is not the canonical community membership PDA.');
        }
        const memberships = await sql<CommunityMembershipRow[]>`
              SELECT *
              FROM community_memberships
              WHERE network_id = ${event.networkId}
                AND community_address = ${event.communityAddress}
                AND member_identity_id = ${event.voterIdentityId}
            `;
        const membership = memberships[0];
        if (
          membership === undefined ||
          membership.membership_address !== event.membershipAddress ||
          BigInt(membership.state_sequence) !== event.membershipStateSequence ||
          !membership.active ||
          (membership.roles & 0x01) !== 0x01 ||
          BigInt(membership.updated_slot) > BigInt(proposal.created_slot) ||
          BigInt(membership.authority_sequence) >= BigInt(proposal.proposer_sequence)
        ) {
          throw stale('Vote membership does not match the proposal eligibility snapshot.');
        }
        const duplicate = await sql`
              SELECT 1
              FROM governance_votes
              WHERE network_id = ${event.networkId}
                AND (
                  vote_address = ${event.voteAddress}
                  OR (
                    proposal_address = ${event.proposalAddress}
                    AND voter_identity_id = ${event.voterIdentityId}
                  )
                )
              LIMIT 1
            `;
        if (duplicate.length !== 0) {
          throw stale('Voter already has a projected vote for this proposal.');
        }
        const priorSequences = await sql<{ voter_sequence: string }[]>`
              SELECT voter_sequence
              FROM governance_votes
              WHERE network_id = ${event.networkId}
                AND voter_identity_id = ${event.voterIdentityId}
              ORDER BY voter_sequence DESC
              LIMIT 1
            `;
        if (
          priorSequences[0] !== undefined &&
          event.voterSequence <= BigInt(priorSequences[0].voter_sequence)
        ) {
          throw stale('Vote does not advance the voter governance sequence.');
        }
        if (event.proposalStateSequence !== BigInt(proposal.state_sequence) + 1n) {
          throw stale('Vote does not advance the proposal state sequence by one.');
        }
        const expectedYes = BigInt(proposal.yes_votes) + (event.choice === 'yes' ? 1n : 0n);
        const expectedNo = BigInt(proposal.no_votes) + (event.choice === 'no' ? 1n : 0n);
        const expectedAbstain =
          BigInt(proposal.abstain_votes) + (event.choice === 'abstain' ? 1n : 0n);
        if (
          event.yesVotes !== expectedYes ||
          event.noVotes !== expectedNo ||
          event.abstainVotes !== expectedAbstain ||
          event.yesVotes + event.noVotes + event.abstainVotes >
            BigInt(proposal.eligible_member_count)
        ) {
          throw stale('Vote post-event counts do not exactly advance the indexed tally.');
        }
        await sql`
              INSERT INTO governance_votes (
                vote_address, network_id, community_address, proposal_address,
                voter_identity_id, membership_address, authority, voter_sequence,
                membership_state_sequence, proposal_state_sequence, choice,
                yes_votes, no_votes, abstain_votes, cast_slot, cast_at
              ) VALUES (
                ${event.voteAddress}, ${event.networkId}, ${event.communityAddress},
                ${event.proposalAddress}, ${event.voterIdentityId},
                ${event.membershipAddress}, ${event.authority},
                ${event.voterSequence.toString()},
                ${event.membershipStateSequence.toString()},
                ${event.proposalStateSequence.toString()}, ${event.choice},
                ${event.yesVotes.toString()}, ${event.noVotes.toString()},
                ${event.abstainVotes.toString()}, ${event.slot.toString()},
                ${event.blockTime}
              )
            `;
        const updated = await sql`
              UPDATE governance_proposals
              SET yes_votes = ${event.yesVotes.toString()},
                  no_votes = ${event.noVotes.toString()},
                  abstain_votes = ${event.abstainVotes.toString()},
                  state_sequence = ${event.proposalStateSequence.toString()}
              WHERE proposal_address = ${event.proposalAddress}
                AND network_id = ${event.networkId}
                AND outcome = 'pending'
                AND state_sequence + 1 = ${event.proposalStateSequence.toString()}
              RETURNING proposal_address
            `;
        if (updated.length !== 1) {
          throw stale('Vote could not advance the indexed proposal.');
        }
        break;
      }
      case 'proposal-finalized': {
        const proposals = await sql<GovernanceProposalRow[]>`
              SELECT *
              FROM governance_proposals
              WHERE network_id = ${event.networkId}
                AND proposal_address = ${event.proposalAddress}
              FOR UPDATE
            `;
        const proposal = proposals[0];
        if (
          proposal === undefined ||
          proposal.network_id !== event.networkId ||
          proposal.community_address !== event.communityAddress ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          proposal.outcome !== 'pending' ||
          proposal.finalized_slot !== null
        ) {
          throw stale('Finalization does not match a pending indexed proposal.');
        }
        const yesVotes = BigInt(proposal.yes_votes);
        const noVotes = BigInt(proposal.no_votes);
        const abstainVotes = BigInt(proposal.abstain_votes);
        const eligibleMemberCount = BigInt(proposal.eligible_member_count);
        const participatingVotes = yesVotes + noVotes + abstainVotes;
        const decisiveVotes = yesVotes + noVotes;
        const quorumMet =
          participatingVotes * 10_000n >= eligibleMemberCount * BigInt(proposal.quorum_bps);
        const approvalMet =
          decisiveVotes > 0n && yesVotes * 10_000n >= decisiveVotes * BigInt(proposal.approval_bps);
        const outcome = quorumMet && approvalMet ? 'accepted' : 'rejected';
        if (
          event.slot < BigInt(proposal.closes_at_slot) ||
          event.proposalStateSequence !== BigInt(proposal.state_sequence) + 1n ||
          event.eligibleMemberCount !== eligibleMemberCount ||
          event.yesVotes !== yesVotes ||
          event.noVotes !== noVotes ||
          event.abstainVotes !== abstainVotes ||
          event.participatingVotes !== participatingVotes ||
          event.decisiveVotes !== decisiveVotes ||
          event.quorumBps !== proposal.quorum_bps ||
          event.approvalBps !== proposal.approval_bps ||
          event.quorumMet !== quorumMet ||
          event.approvalMet !== approvalMet ||
          event.outcome !== outcome
        ) {
          throw stale(
            'Finalization counts, thresholds, result, timing, or sequence do not match proposal.',
          );
        }
        const updated = await sql`
              UPDATE governance_proposals
              SET state_sequence = ${event.proposalStateSequence.toString()},
                  outcome = ${event.outcome},
                  finalizer = ${event.finalizer},
                  participating_votes = ${event.participatingVotes.toString()},
                  decisive_votes = ${event.decisiveVotes.toString()},
                  quorum_met = ${event.quorumMet},
                  approval_met = ${event.approvalMet},
                  finalized_slot = ${event.slot.toString()},
                  finalized_at = ${event.blockTime}
              WHERE proposal_address = ${event.proposalAddress}
                AND network_id = ${event.networkId}
                AND outcome = 'pending'
                AND state_sequence + 1 = ${event.proposalStateSequence.toString()}
              RETURNING proposal_address
            `;
        if (updated.length !== 1) {
          throw stale('Finalization could not close the indexed proposal.');
        }
        break;
      }
      case 'payment-config-initialized': {
        const protocolConfig = await sql`
          SELECT 1
          FROM protocol_configs
          WHERE network_id = ${event.networkId}
        `;
        if (
          protocolConfig.length !== 1 ||
          !programMatchesNetwork(event.networkId, event.programId) ||
          event.paymentConfigAddress !== (await derivePaymentConfigAddress(event.programId)) ||
          isDefaultPublicKey(event.upgradeAuthority) ||
          isDefaultPublicKey(event.paymentAuthority) ||
          isDefaultPublicKey(event.feeDestination)
        ) {
          throw stale('Payment configuration initialization is substituted or invalid.');
        }
        const created = await sql`
          INSERT INTO payment_configs (
            network_id, payment_config_address, upgrade_authority, authority,
            fee_destination, fee_bps, policy_sequence, enabled,
            initialized_slot, initialized_at, updated_slot, updated_at,
            transaction_signature, transaction_index, log_index
          ) VALUES (
            ${event.networkId}, ${event.paymentConfigAddress}, ${event.upgradeAuthority},
            ${event.paymentAuthority}, ${event.feeDestination}, ${event.feeBps},
            ${event.policySequence.toString()}, ${event.enabled}, ${event.slot.toString()},
            ${event.blockTime}, ${event.slot.toString()}, ${event.blockTime},
            ${event.transactionSignature}, ${event.transactionIndex ?? null}, ${event.logIndex}
          )
          ON CONFLICT DO NOTHING
          RETURNING payment_config_address
        `;
        if (created.length !== 1) {
          throw stale('Payment configuration was already projected.');
        }
        break;
      }
      case 'payment-config-updated': {
        const current = await requirePaymentConfigRow(
          sql,
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        if (
          event.authority !== current.authority ||
          event.previousFeeDestination !== current.fee_destination ||
          event.previousFeeBps !== current.fee_bps ||
          event.previousEnabled !== current.enabled ||
          event.policySequence !== BigInt(current.policy_sequence) + 1n ||
          (event.previousFeeDestination === event.feeDestination &&
            event.previousFeeBps === event.feeBps &&
            event.previousEnabled === event.enabled) ||
          isDefaultPublicKey(event.feeDestination)
        ) {
          throw stale('Payment policy update does not exactly advance indexed policy state.');
        }
        const updated = await sql`
          UPDATE payment_configs
          SET fee_destination = ${event.feeDestination},
              fee_bps = ${event.feeBps},
              policy_sequence = ${event.policySequence.toString()},
              enabled = ${event.enabled},
              updated_slot = ${event.slot.toString()},
              updated_at = ${event.blockTime},
              transaction_signature = ${event.transactionSignature},
              transaction_index = ${event.transactionIndex ?? null},
              log_index = ${event.logIndex}
          WHERE network_id = ${event.networkId}
            AND payment_config_address = ${event.paymentConfigAddress}
            AND policy_sequence + 1 = ${event.policySequence.toString()}
          RETURNING payment_config_address
        `;
        if (updated.length !== 1) {
          throw stale('Payment policy update could not advance indexed policy state.');
        }
        break;
      }
      case 'payment-authority-rotated': {
        const current = await requirePaymentConfigRow(
          sql,
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        if (
          event.previousAuthority !== current.authority ||
          event.newAuthority === current.authority ||
          isDefaultPublicKey(event.newAuthority) ||
          event.policySequence !== BigInt(current.policy_sequence) + 1n
        ) {
          throw stale('Payment authority rotation does not advance indexed policy state.');
        }
        const updated = await sql`
          UPDATE payment_configs
          SET authority = ${event.newAuthority},
              policy_sequence = ${event.policySequence.toString()},
              updated_slot = ${event.slot.toString()},
              updated_at = ${event.blockTime},
              transaction_signature = ${event.transactionSignature},
              transaction_index = ${event.transactionIndex ?? null},
              log_index = ${event.logIndex}
          WHERE network_id = ${event.networkId}
            AND payment_config_address = ${event.paymentConfigAddress}
            AND authority = ${event.previousAuthority}
            AND policy_sequence + 1 = ${event.policySequence.toString()}
          RETURNING payment_config_address
        `;
        if (updated.length !== 1) {
          throw stale('Payment authority rotation could not advance indexed policy state.');
        }
        break;
      }
      case 'subscription-offering-created': {
        const paymentConfig = await requirePaymentConfigRow(
          sql,
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const creator = await requirePaymentIdentity(sql, event.networkId, event.creatorIdentityId);
        const expectedAddress = await deriveSubscriptionOfferingAddress(
          event.programId,
          creator.identity_address,
          paymentNonce(event.offeringNonce),
        );
        const priorSequence = await sql<{ creator_sequence: string }[]>`
          SELECT creator_sequence
          FROM subscription_offerings
          WHERE network_id = ${event.networkId}
            AND creator_identity_id = ${event.creatorIdentityId}
          ORDER BY creator_sequence DESC
          LIMIT 1
        `;
        if (
          creator.root_authority !== event.rootAuthority ||
          BigInt(creator.root_rotation_count) !== event.creatorRootRotationCount ||
          event.offeringAddress !== expectedAddress ||
          paymentConfig.fee_bps > event.maxProtocolFeeBps ||
          (priorSequence[0] !== undefined &&
            event.creatorSequence <= BigInt(priorSequence[0].creator_sequence))
        ) {
          throw stale('Subscription offering does not match indexed creator or payment state.');
        }
        const recipientSplits = await requirePaymentSplits(
          sql,
          event.networkId,
          event.recipientSplits,
        );
        if (
          !recipientSplits.some(
            (split) =>
              split.recipientIdentityId === event.creatorIdentityId &&
              split.destination === event.rootAuthority,
          )
        ) {
          throw stale('Subscription offering does not pay its creator root authority.');
        }
        assertPaymentAllocation(event.priceLamports, event.maxProtocolFeeBps, recipientSplits);
        const created = await sql`
          INSERT INTO subscription_offerings (
            network_id, offering_address, payment_config_address, creator_identity_id,
            root_authority, offering_nonce, manifest_hash, manifest_uri, price_lamports,
            billing_interval, refund_policy_hash, max_protocol_fee_bps,
            creator_root_rotation_count, creator_sequence, state_sequence, active,
            created_slot, created_at, updated_slot, updated_at,
            transaction_signature, transaction_index, log_index
          ) VALUES (
            ${event.networkId}, ${event.offeringAddress}, ${event.paymentConfigAddress},
            ${event.creatorIdentityId}, ${event.rootAuthority}, ${event.offeringNonce},
            ${event.manifestHash}, ${event.manifestUri}, ${event.priceLamports.toString()},
            ${event.billingInterval}, ${event.refundPolicyHash}, ${event.maxProtocolFeeBps},
            ${event.creatorRootRotationCount.toString()}, ${event.creatorSequence.toString()},
            ${event.offeringStateSequence.toString()}, true, ${event.slot.toString()},
            ${event.blockTime}, ${event.slot.toString()}, ${event.blockTime},
            ${event.transactionSignature}, ${event.transactionIndex ?? null}, ${event.logIndex}
          )
          ON CONFLICT DO NOTHING
          RETURNING offering_address
        `;
        if (created.length !== 1) {
          throw stale('Subscription offering address or nonce was already projected.');
        }
        for (const [index, split] of recipientSplits.entries()) {
          await sql`
            INSERT INTO subscription_offering_splits (
              network_id, offering_address, split_index,
              recipient_identity_id, destination, basis_points
            ) VALUES (
              ${event.networkId}, ${event.offeringAddress}, ${index},
              ${split.recipientIdentityId}, ${split.destination}, ${split.basisPoints}
            )
          `;
        }
        break;
      }
      case 'subscription-offering-retired': {
        const offerings = await sql<SubscriptionOfferingRow[]>`
          SELECT *
          FROM subscription_offerings
          WHERE network_id = ${event.networkId}
            AND offering_address = ${event.offeringAddress}
          FOR UPDATE
        `;
        const current = offerings[0];
        const creator = await requirePaymentIdentity(sql, event.networkId, event.creatorIdentityId);
        if (
          current === undefined ||
          current.creator_identity_id !== event.creatorIdentityId ||
          creator.root_authority !== event.rootAuthority ||
          current.manifest_hash !== event.manifestHash ||
          !current.active ||
          current.retired_slot !== null ||
          event.creatorSequence <= BigInt(current.creator_sequence) ||
          event.offeringStateSequence !== BigInt(current.state_sequence) + 1n
        ) {
          throw stale('Subscription retirement does not advance the active indexed offering.');
        }
        const updated = await sql`
          UPDATE subscription_offerings
          SET root_authority = ${event.rootAuthority},
              creator_sequence = ${event.creatorSequence.toString()},
              state_sequence = ${event.offeringStateSequence.toString()},
              active = false,
              updated_slot = ${event.slot.toString()},
              updated_at = ${event.blockTime},
              retired_slot = ${event.slot.toString()},
              retired_at = ${event.blockTime},
              transaction_signature = ${event.transactionSignature},
              transaction_index = ${event.transactionIndex ?? null},
              log_index = ${event.logIndex}
          WHERE network_id = ${event.networkId}
            AND offering_address = ${event.offeringAddress}
            AND active
            AND retired_slot IS NULL
            AND state_sequence + 1 = ${event.offeringStateSequence.toString()}
          RETURNING offering_address
        `;
        if (updated.length !== 1) {
          throw stale('Subscription retirement could not advance indexed offering state.');
        }
        break;
      }
      case 'woke-tip-settled': {
        const paymentConfig = await requirePaymentConfigRow(
          sql,
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const payer = await requirePaymentIdentity(sql, event.networkId, event.payerIdentityId);
        const recipient = await requirePaymentIdentity(
          sql,
          event.networkId,
          event.recipientIdentityId,
        );
        const expectedReceipt = await derivePaymentReceiptAddress(
          event.programId,
          payer.identity_address,
          paymentNonce(event.receiptNonce),
        );
        const recipientSplits = await requirePaymentSplits(sql, event.networkId, [
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
          event.paymentPolicySequence !== BigInt(paymentConfig.policy_sequence) ||
          event.feeBps !== paymentConfig.fee_bps ||
          event.feeDestination !== paymentConfig.fee_destination ||
          payer.root_authority !== event.payerAuthority ||
          BigInt(payer.root_rotation_count) !== event.payerRootRotationCount ||
          recipient.root_authority !== event.recipientDestination ||
          event.payerIdentityId === event.recipientIdentityId ||
          event.payerAuthority === event.feeDestination ||
          event.payerAuthority === event.recipientDestination ||
          event.feeDestination === event.recipientDestination ||
          event.receiptAddress !== expectedReceipt ||
          event.feeLamports !== allocation.feeLamports ||
          event.distributableLamports !== allocation.distributableLamports ||
          event.recipientLamports !== allocation.recipientAmounts[0]
        ) {
          throw stale('Woke tip receipt does not match indexed identities or payment policy.');
        }
        await insertPaymentReceipt(sql, event, {
          termsReference: recipient.identity_address,
          subjectIdentityId: event.recipientIdentityId,
          primaryRecipientDestination: event.recipientDestination,
          termsStateSequence: 0n,
          termsManifestHash: ZERO_DIGEST,
          recipientSplits,
          recipientAmounts: [event.recipientLamports],
          refundPolicyHash: ZERO_DIGEST,
          entitlementFromTimestamp: 0n,
          entitlementUntilTimestamp: 0n,
        });
        break;
      }
      case 'subscription-settled': {
        const paymentConfig = await requirePaymentConfigRow(
          sql,
          event.networkId,
          event.programId,
          event.paymentConfigAddress,
        );
        const payer = await requirePaymentIdentity(sql, event.networkId, event.payerIdentityId);
        const creator = await requirePaymentIdentity(sql, event.networkId, event.creatorIdentityId);
        const offeringRows = await sql<SubscriptionOfferingRow[]>`
          SELECT *
          FROM subscription_offerings
          WHERE network_id = ${event.networkId}
            AND offering_address = ${event.offeringAddress}
          FOR UPDATE
        `;
        const offering = offeringRows[0];
        const offeringSplits =
          offering === undefined
            ? []
            : await selectOfferingSplitsInTransaction(sql, event.networkId, event.offeringAddress);
        const entitlements = await sql<SubscriptionEntitlementRow[]>`
          SELECT *
          FROM subscription_entitlements
          WHERE network_id = ${event.networkId}
            AND entitlement_address = ${event.entitlementAddress}
          FOR UPDATE
        `;
        const currentEntitlement = entitlements[0];
        const expectedReceipt = await derivePaymentReceiptAddress(
          event.programId,
          payer.identity_address,
          paymentNonce(event.receiptNonce),
        );
        const expectedEntitlement = await deriveSubscriptionEntitlementAddress(
          event.programId,
          event.offeringAddress,
          payer.identity_address,
        );
        const recipientSplits = await requirePaymentSplits(
          sql,
          event.networkId,
          event.recipientSplits,
        );
        const allocation = assertPaymentAllocation(
          event.grossLamports,
          event.feeBps,
          recipientSplits,
        );
        const expectedWindow = assertSubscriptionWindow(
          event.paidAtTimestamp,
          currentEntitlement === undefined ? 0n : BigInt(currentEntitlement.valid_until_timestamp),
        );
        const expectedStateSequence =
          (currentEntitlement === undefined ? 0n : BigInt(currentEntitlement.state_sequence)) + 1n;
        const expectedSettlementCount =
          (currentEntitlement === undefined ? 0n : BigInt(currentEntitlement.settlement_count)) +
          1n;
        if (
          offering === undefined ||
          !offering.active ||
          offering.creator_identity_id !== event.creatorIdentityId ||
          BigInt(creator.root_rotation_count) !== BigInt(offering.creator_root_rotation_count) ||
          payer.root_authority !== event.payerAuthority ||
          BigInt(payer.root_rotation_count) !== event.payerRootRotationCount ||
          !paymentConfig.enabled ||
          event.paymentPolicySequence !== BigInt(paymentConfig.policy_sequence) ||
          event.feeBps !== paymentConfig.fee_bps ||
          event.feeDestination !== paymentConfig.fee_destination ||
          event.offeringStateSequence !== BigInt(offering.state_sequence) ||
          event.offeringManifestHash !== offering.manifest_hash ||
          event.refundPolicyHash !== offering.refund_policy_hash ||
          event.grossLamports !== BigInt(offering.price_lamports) ||
          event.feeBps > offering.max_protocol_fee_bps ||
          !samePaymentSplits(recipientSplits, offeringSplits) ||
          !sameBigInts(event.recipientAmounts, allocation.recipientAmounts) ||
          event.feeLamports !== allocation.feeLamports ||
          event.distributableLamports !== allocation.distributableLamports ||
          recipientSplits.some(
            (split) =>
              split.recipientIdentityId === event.payerIdentityId ||
              split.destination === event.payerAuthority ||
              split.destination === event.feeDestination,
          ) ||
          event.payerAuthority === event.feeDestination ||
          event.receiptAddress !== expectedReceipt ||
          event.entitlementAddress !== expectedEntitlement ||
          (currentEntitlement !== undefined &&
            (currentEntitlement.offering_address !== event.offeringAddress ||
              currentEntitlement.beneficiary_identity_id !== event.payerIdentityId ||
              currentEntitlement.refund_policy_hash !== event.refundPolicyHash)) ||
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
        await insertPaymentReceipt(sql, event, {
          termsReference: event.offeringAddress,
          subjectIdentityId: event.payerIdentityId,
          primaryRecipientDestination: creatorSplit.destination,
          termsStateSequence: event.offeringStateSequence,
          termsManifestHash: event.offeringManifestHash,
          recipientSplits,
          recipientAmounts: event.recipientAmounts,
          refundPolicyHash: event.refundPolicyHash,
          entitlementFromTimestamp: event.entitlementFromTimestamp,
          entitlementUntilTimestamp: event.entitlementUntilTimestamp,
        });
        if (currentEntitlement === undefined) {
          await sql`
            INSERT INTO subscription_entitlements (
              network_id, entitlement_address, offering_address,
              beneficiary_identity_id, started_at_timestamp, valid_until_timestamp,
              settlement_count, last_receipt_address, state_sequence,
              last_settled_at_slot, refund_policy_hash, recorded_at,
              transaction_signature, transaction_index, log_index
            ) VALUES (
              ${event.networkId}, ${event.entitlementAddress}, ${event.offeringAddress},
              ${event.payerIdentityId}, ${event.entitlementFromTimestamp.toString()},
              ${event.entitlementUntilTimestamp.toString()}, ${event.settlementCount.toString()},
              ${event.receiptAddress}, ${event.entitlementStateSequence.toString()},
              ${event.slot.toString()}, ${event.refundPolicyHash}, ${event.blockTime},
              ${event.transactionSignature}, ${event.transactionIndex ?? null}, ${event.logIndex}
            )
          `;
        } else {
          const updated = await sql`
            UPDATE subscription_entitlements
            SET valid_until_timestamp = ${event.entitlementUntilTimestamp.toString()},
                settlement_count = ${event.settlementCount.toString()},
                last_receipt_address = ${event.receiptAddress},
                state_sequence = ${event.entitlementStateSequence.toString()},
                last_settled_at_slot = ${event.slot.toString()},
                recorded_at = ${event.blockTime},
                transaction_signature = ${event.transactionSignature},
                transaction_index = ${event.transactionIndex ?? null},
                log_index = ${event.logIndex}
            WHERE network_id = ${event.networkId}
              AND entitlement_address = ${event.entitlementAddress}
              AND state_sequence + 1 = ${event.entitlementStateSequence.toString()}
              AND settlement_count + 1 = ${event.settlementCount.toString()}
            RETURNING entitlement_address
          `;
          if (updated.length !== 1) {
            throw stale('Subscription entitlement could not advance indexed state.');
          }
        }
        break;
      }
    }

    await sql`
      INSERT INTO indexer_checkpoints (
        network_id, finalized_slot, transaction_signature, log_index
      ) VALUES (
        ${event.networkId}, ${event.slot.toString()},
        ${event.transactionSignature}, ${event.logIndex}
      )
      ON CONFLICT (network_id) DO UPDATE SET
        finalized_slot = EXCLUDED.finalized_slot,
        transaction_signature = EXCLUDED.transaction_signature,
        log_index = EXCLUDED.log_index,
        updated_at = now()
      WHERE indexer_checkpoints.finalized_slot <= EXCLUDED.finalized_slot
    `;
    return true;
  }

  async advanceCheckpoint(
    networkId: string,
    finalizedSlot: bigint,
    transactionSignature: string,
    logIndex: number,
  ): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await this.#lockNetwork(sql, networkId);
      await sql`
        INSERT INTO indexer_checkpoints (
          network_id, finalized_slot, transaction_signature, log_index
        ) VALUES (
          ${networkId}, ${finalizedSlot.toString()}, ${transactionSignature}, ${logIndex}
        )
        ON CONFLICT (network_id) DO UPDATE SET
          finalized_slot = EXCLUDED.finalized_slot,
          transaction_signature = EXCLUDED.transaction_signature,
          log_index = EXCLUDED.log_index,
          updated_at = now()
        WHERE indexer_checkpoints.finalized_slot <= EXCLUDED.finalized_slot
      `;
    });
  }

  async getPost(objectId: string): Promise<PostProjection | undefined> {
    const rows = await this.#sql<PostRow[]>`
      SELECT * FROM posts WHERE object_id = ${objectId}
    `;
    return rows[0] === undefined ? undefined : postFromRow(rows[0]);
  }

  async findPostObjectIdByReference(
    networkId: string,
    onchainReference: string,
  ): Promise<string | undefined> {
    const rows = await this.#sql<{ object_id: string }[]>`
      SELECT event_body ->> 'objectId' AS object_id
      FROM protocol_events
      WHERE network_id = ${networkId}
        AND event_type = 'post-published'
        AND event_body ->> 'postReference' = ${onchainReference}
      ORDER BY slot DESC, transaction_signature DESC, log_index DESC
      LIMIT 1
    `;
    return rows[0]?.object_id;
  }

  async getProfile(identityId: string): Promise<ProfileProjection | undefined> {
    const rows = await this.#sql<ProfileRow[]>`
      SELECT * FROM profiles WHERE identity_id = ${identityId}
    `;
    return rows[0] === undefined ? undefined : profileFromRow(rows[0]);
  }

  async getIdentity(identityId: string): Promise<IdentityProjection | undefined> {
    const rows = await this.#sql<IdentityRow[]>`
      SELECT * FROM identities WHERE identity_id = ${identityId}
    `;
    return rows[0] === undefined ? undefined : identityFromRow(rows[0]);
  }

  async getProtocolConfig(networkId: string): Promise<ProtocolConfigProjection | undefined> {
    const rows = await this.#sql<ProtocolConfigRow[]>`
      SELECT * FROM protocol_configs WHERE network_id = ${networkId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          networkId: row.network_id,
          configAddress: row.config_address,
          initializedSlot: BigInt(row.initialized_slot),
          initializedAt: dateString(row.initialized_at),
        };
  }

  async getHandle(networkId: string, handle: string): Promise<HandleProjection | undefined> {
    const rows = await this.#sql<HandleRow[]>`
      SELECT *
      FROM handle_claims
      WHERE network_id = ${networkId}
        AND handle = ${handle}
        AND active
    `;
    return rows[0] === undefined ? undefined : handleFromRow(rows[0]);
  }

  async getHandlesByIdentity(identityId: string): Promise<readonly HandleProjection[]> {
    const rows = await this.#sql<HandleRow[]>`
      SELECT *
      FROM handle_claims
      WHERE identity_id = ${identityId}
        AND active
      ORDER BY handle
    `;
    return rows.map(handleFromRow);
  }

  async getDelegations(identityId: string): Promise<readonly DelegationProjection[]> {
    const rows = await this.#sql<DelegationRow[]>`
      SELECT *
      FROM delegations
      WHERE identity_id = ${identityId}
      ORDER BY delegation_sequence, delegation_address
    `;
    return rows.map(delegationFromRow);
  }

  async authorizeSigningKey(query: SigningKeyAuthorizationQuery): Promise<boolean> {
    const history = await this.#sql<RootHistoryRow[]>`
      SELECT *
      FROM root_authority_history
      WHERE identity_id = ${query.identityId}
    `;
    const queryPosition = positionFor(query);
    const root = history
      .filter((row) => comparePosition(rootPosition(row), queryPosition) <= 0)
      .sort((left, right) => comparePosition(rootPosition(right), rootPosition(left)))[0];
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
    const delegations = await this.#sql<DelegationRow[]>`
      SELECT *
      FROM delegations
      WHERE identity_id = ${query.identityId}
        AND delegate_authority = ${query.authority}
        AND issued_at_root_rotation_count = ${root.rotation_count}
        AND expires_at_slot >= ${query.slot.toString()}
        AND (scopes & ${requiredScope}) = ${requiredScope}
    `;
    return delegations.some((delegation) => {
      const created = delegationCreatedPosition(delegation);
      const revoked = delegationRevokedPosition(delegation);
      return (
        comparePosition(created, queryPosition) <= 0 &&
        (revoked === undefined || comparePosition(queryPosition, revoked) < 0)
      );
    });
  }

  async getBlock(
    blockerIdentityId: string,
    subjectIdentityId: string,
  ): Promise<BlockProjection | undefined> {
    const rows = await this.#sql<BlockRow[]>`
      SELECT *
      FROM blocks
      WHERE blocker_identity_id = ${blockerIdentityId}
        AND subject_identity_id = ${subjectIdentityId}
    `;
    return rows[0] === undefined ? undefined : blockFromRow(rows[0]);
  }

  async getCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<CommunityProjection | undefined> {
    const rows = await this.#sql<CommunityRow[]>`
      SELECT *
      FROM communities
      WHERE network_id = ${networkId}
        AND community_address = ${communityAddress}
    `;
    return rows[0] === undefined ? undefined : communityFromRow(rows[0]);
  }

  async getCommunityMemberships(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly CommunityMembershipProjection[]> {
    const rows = await this.#sql<CommunityMembershipRow[]>`
      SELECT *
      FROM community_memberships
      WHERE network_id = ${networkId}
        AND community_address = ${communityAddress}
      ORDER BY member_identity_id
    `;
    return rows.map(membershipFromRow);
  }

  async getReactionsByPostReference(
    networkId: string,
    targetPostReference: string,
  ): Promise<readonly ReactionProjection[]> {
    const rows = await this.#sql<ReactionRow[]>`
      SELECT *
      FROM reactions
      WHERE network_id = ${networkId}
        AND target_post_reference = ${targetPostReference}
      ORDER BY reaction_kind, reactor_identity_id
    `;
    return rows.map(reactionFromRow);
  }

  async getRecoveryPolicy(identityId: string): Promise<RecoveryPolicyProjection | undefined> {
    const rows = await this.#sql<RecoveryPolicyRow[]>`
      SELECT *
      FROM recovery_policies
      WHERE identity_id = ${identityId}
    `;
    return rows[0] === undefined ? undefined : recoveryPolicyFromRow(rows[0]);
  }

  async getRecoveryRequest(
    networkId: string,
    recoveryRequestAddress: string,
  ): Promise<RecoveryRequestProjection | undefined> {
    const rows = await this.#sql<RecoveryRequestRow[]>`
      SELECT *
      FROM recovery_requests
      WHERE network_id = ${networkId}
        AND recovery_request_address = ${recoveryRequestAddress}
    `;
    return rows[0] === undefined ? undefined : recoveryRequestFromRow(rows[0]);
  }

  async getRecoveryRequestsByIdentity(
    identityId: string,
  ): Promise<readonly RecoveryRequestProjection[]> {
    const rows = await this.#sql<RecoveryRequestRow[]>`
      SELECT *
      FROM recovery_requests
      WHERE identity_id = ${identityId}
      ORDER BY requested_slot, recovery_request_address
    `;
    return rows.map(recoveryRequestFromRow);
  }

  async getGovernanceProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<GovernanceProposalProjection | undefined> {
    const rows = await this.#sql<GovernanceProposalRow[]>`
      SELECT *
      FROM governance_proposals
      WHERE network_id = ${networkId}
        AND proposal_address = ${proposalAddress}
    `;
    return rows[0] === undefined ? undefined : governanceProposalFromRow(rows[0]);
  }

  async getGovernanceProposalsByCommunity(
    networkId: string,
    communityAddress: string,
  ): Promise<readonly GovernanceProposalProjection[]> {
    const rows = await this.#sql<GovernanceProposalRow[]>`
      SELECT *
      FROM governance_proposals
      WHERE network_id = ${networkId}
        AND community_address = ${communityAddress}
      ORDER BY created_slot, proposal_address
    `;
    return rows.map(governanceProposalFromRow);
  }

  async getGovernanceVote(
    networkId: string,
    voteAddress: string,
  ): Promise<GovernanceVoteProjection | undefined> {
    const rows = await this.#sql<GovernanceVoteRow[]>`
      SELECT *
      FROM governance_votes
      WHERE network_id = ${networkId}
        AND vote_address = ${voteAddress}
    `;
    return rows[0] === undefined ? undefined : governanceVoteFromRow(rows[0]);
  }

  async getGovernanceVotesByProposal(
    networkId: string,
    proposalAddress: string,
  ): Promise<readonly GovernanceVoteProjection[]> {
    const rows = await this.#sql<GovernanceVoteRow[]>`
      SELECT *
      FROM governance_votes
      WHERE network_id = ${networkId}
        AND proposal_address = ${proposalAddress}
      ORDER BY proposal_state_sequence, vote_address
    `;
    return rows.map(governanceVoteFromRow);
  }

  async getPaymentConfig(networkId: string): Promise<PaymentConfigProjection | undefined> {
    const rows = await this.#sql<PaymentConfigRow[]>`
      SELECT *
      FROM payment_configs
      WHERE network_id = ${networkId}
    `;
    return rows[0] === undefined ? undefined : paymentConfigFromRow(rows[0]);
  }

  async getSubscriptionOffering(
    networkId: string,
    offeringAddress: string,
  ): Promise<SubscriptionOfferingProjection | undefined> {
    const rows = await this.#sql<SubscriptionOfferingRow[]>`
      SELECT *
      FROM subscription_offerings
      WHERE network_id = ${networkId}
        AND offering_address = ${offeringAddress}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const splits = await selectOfferingSplits(this.#sql, networkId, offeringAddress);
    return subscriptionOfferingFromRow(row, splits);
  }

  async getSubscriptionOfferingsByCreator(
    networkId: string,
    creatorIdentityId: string,
  ): Promise<readonly SubscriptionOfferingProjection[]> {
    const rows = await this.#sql<SubscriptionOfferingRow[]>`
      SELECT *
      FROM subscription_offerings
      WHERE network_id = ${networkId}
        AND creator_identity_id = ${creatorIdentityId}
      ORDER BY created_slot, offering_address
    `;
    return Promise.all(
      rows.map(async (row) =>
        subscriptionOfferingFromRow(
          row,
          await selectOfferingSplits(this.#sql, row.network_id, row.offering_address),
        ),
      ),
    );
  }

  async getPaymentReceipt(
    networkId: string,
    receiptAddress: string,
  ): Promise<PaymentReceiptProjection | undefined> {
    const rows = await this.#sql<PaymentReceiptRow[]>`
      SELECT *
      FROM payment_receipts
      WHERE network_id = ${networkId}
        AND receipt_address = ${receiptAddress}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const allocations = await selectReceiptAllocations(this.#sql, networkId, receiptAddress);
    return paymentReceiptFromRow(row, allocations);
  }

  async getSubscriptionEntitlement(
    networkId: string,
    entitlementAddress: string,
  ): Promise<SubscriptionEntitlementProjection | undefined> {
    const rows = await this.#sql<SubscriptionEntitlementRow[]>`
      SELECT *
      FROM subscription_entitlements
      WHERE network_id = ${networkId}
        AND entitlement_address = ${entitlementAddress}
    `;
    return rows[0] === undefined ? undefined : subscriptionEntitlementFromRow(rows[0]);
  }

  async getFeed(query: FeedQuery): Promise<readonly FeedEntry[]> {
    const before = query.before ?? '9999-12-31T23:59:59.999Z';
    let rows: FeedRow[];
    if (query.mode === 'following') {
      if (query.viewerIdentityId === undefined) {
        throw new ProjectionError('Following feeds require a viewer identity.', 'database-error');
      }
      rows = await this.#sql<FeedRow[]>`
            SELECT
              p.*,
              i.identity_address, i.root_authority, i.root_rotation_count, i.created_slot,
              i.created_at AS identity_created_at,
              i.updated_slot AS identity_updated_slot,
              i.updated_at AS identity_updated_at,
              pr.object_id AS profile_object_id, pr.cid AS profile_cid,
              pr.payload_hash AS profile_payload_hash,
              pr.display_name, pr.bio, pr.pronouns,
              pr.updated_slot, pr.updated_at
            FROM posts p
            JOIN follows f
              ON f.followed_identity_id = p.author_identity_id
              AND f.follower_identity_id = ${query.viewerIdentityId}
              AND f.active
            JOIN identities i ON i.identity_id = p.author_identity_id
            LEFT JOIN profiles pr ON pr.identity_id = p.author_identity_id
            WHERE p.network_id = ${query.networkId}
              AND p.tombstoned_at IS NULL
              AND p.created_at < ${before}
            ORDER BY p.created_at DESC, p.object_id DESC
            LIMIT ${query.limit}
          `;
    } else {
      rows = await this.#sql<FeedRow[]>`
            SELECT
              p.*,
              i.identity_address, i.root_authority, i.root_rotation_count, i.created_slot,
              i.created_at AS identity_created_at,
              i.updated_slot AS identity_updated_slot,
              i.updated_at AS identity_updated_at,
              pr.object_id AS profile_object_id, pr.cid AS profile_cid,
              pr.payload_hash AS profile_payload_hash,
              pr.display_name, pr.bio, pr.pronouns,
              pr.updated_slot, pr.updated_at
            FROM posts p
            JOIN identities i ON i.identity_id = p.author_identity_id
            LEFT JOIN profiles pr ON pr.identity_id = p.author_identity_id
            WHERE p.network_id = ${query.networkId}
              AND p.tombstoned_at IS NULL
              AND p.created_at < ${before}
            ORDER BY p.created_at DESC, p.object_id DESC
            LIMIT ${query.limit}
          `;
    }

    return rows.map((row) => {
      const entry: FeedEntry = {
        post: postFromRow(row),
        author: {
          identityId: row.author_identity_id,
          networkId: row.network_id,
          identityAddress: row.identity_address,
          rootAuthority: row.root_authority,
          rootRotationCount: BigInt(row.root_rotation_count),
          createdSlot: BigInt(row.created_slot),
          createdAt: dateString(row.identity_created_at),
          updatedSlot: BigInt(row.identity_updated_slot),
          updatedAt: dateString(row.identity_updated_at),
        },
        reason:
          query.mode === 'following'
            ? {
                kind: 'following',
                followedIdentityId: row.author_identity_id,
              }
            : { kind: 'chronological' },
      };

      if (
        row.profile_object_id === null ||
        row.profile_cid === null ||
        row.profile_payload_hash === null ||
        row.display_name === null ||
        row.bio === null ||
        row.pronouns === null ||
        row.updated_slot === null ||
        row.updated_at === null
      ) {
        return entry;
      }

      return {
        ...entry,
        profile: {
          identityId: row.author_identity_id,
          objectId: row.profile_object_id,
          cid: row.profile_cid,
          payloadHash: row.profile_payload_hash,
          content: {
            displayName: row.display_name,
            bio: row.bio,
            pronouns: row.pronouns,
            genderVisibility: 'private' as const,
            chosenFamilyLabels: [],
            links: [],
          },
          updatedSlot: BigInt(row.updated_slot),
          updatedAt: dateString(row.updated_at),
        },
      };
    });
  }

  async clearProjection(networkId: string): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await this.#lockNetwork(sql, networkId);
      await this.#clearMaterializedProjection(sql, networkId);
      await sql`DELETE FROM protocol_events WHERE network_id = ${networkId}`;
      await sql`DELETE FROM indexer_dead_letters WHERE network_id = ${networkId}`;
    });
  }

  async #clearMaterializedProjection(sql: TransactionSql, networkId: string): Promise<void> {
    await sql`DELETE FROM payment_configs WHERE network_id = ${networkId}`;
    await sql`DELETE FROM handle_claims WHERE network_id = ${networkId}`;
    await sql`DELETE FROM reactions WHERE network_id = ${networkId}`;
    await sql`DELETE FROM recovery_requests WHERE network_id = ${networkId}`;
    await sql`DELETE FROM recovery_policies WHERE network_id = ${networkId}`;
    await sql`DELETE FROM governance_votes WHERE network_id = ${networkId}`;
    await sql`DELETE FROM governance_proposals WHERE network_id = ${networkId}`;
    await sql`DELETE FROM community_memberships WHERE network_id = ${networkId}`;
    await sql`DELETE FROM communities WHERE network_id = ${networkId}`;
    await sql`DELETE FROM blocks WHERE network_id = ${networkId}`;
    await sql`DELETE FROM delegations WHERE network_id = ${networkId}`;
    await sql`DELETE FROM follows WHERE follower_identity_id IN (
      SELECT identity_id FROM identities WHERE network_id = ${networkId}
    ) OR followed_identity_id IN (
      SELECT identity_id FROM identities WHERE network_id = ${networkId}
    )`;
    await sql`DELETE FROM profiles WHERE identity_id IN (
      SELECT identity_id FROM identities WHERE network_id = ${networkId}
    )`;
    await sql`DELETE FROM posts WHERE network_id = ${networkId}`;
    await sql`DELETE FROM identities WHERE network_id = ${networkId}`;
    await sql`DELETE FROM protocol_configs WHERE network_id = ${networkId}`;
    await sql`DELETE FROM indexer_checkpoints WHERE network_id = ${networkId}`;
  }

  async #lockNetwork(sql: TransactionSql, networkId: string): Promise<void> {
    await sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${networkId}, 0))
    `;
  }

  async checkpoint(networkId: string): Promise<bigint | undefined> {
    const rows = await this.#sql<{ finalized_slot: string }[]>`
      SELECT finalized_slot
      FROM indexer_checkpoints
      WHERE network_id = ${networkId}
    `;
    return rows[0] === undefined ? undefined : BigInt(rows[0].finalized_slot);
  }

  async deadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<DeadLetterRecord | undefined> {
    const rows = await this.#sql<{ attempts: number; next_attempt_at: Date | string | null }[]>`
      SELECT attempts, next_attempt_at
      FROM indexer_dead_letters
      WHERE network_id = ${networkId}
        AND transaction_signature = ${transactionSignature}
        AND log_index = ${logIndex}
    `;
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      attempts: row.attempts,
      ...(row.next_attempt_at === null ? {} : { nextAttemptAt: dateString(row.next_attempt_at) }),
    };
  }

  async recordDeadLetter(input: DeadLetterInput): Promise<DeadLetterRecord> {
    const rows = await this.#sql<{ attempts: number; next_attempt_at: Date | string | null }[]>`
      INSERT INTO indexer_dead_letters (
        network_id, transaction_signature, log_index, event_body,
        failure_code, failure_detail, next_attempt_at
      ) VALUES (
        ${input.networkId}, ${input.transactionSignature}, ${input.logIndex},
        ${this.#sql.json(toJsonValue(input.eventBody))}, ${input.failureCode},
        ${input.failureDetail}, ${input.nextAttemptAt ?? null}
      )
      ON CONFLICT (network_id, transaction_signature, log_index)
      DO UPDATE SET
        event_body = EXCLUDED.event_body,
        failure_code = EXCLUDED.failure_code,
        failure_detail = EXCLUDED.failure_detail,
        attempts = indexer_dead_letters.attempts + 1,
        next_attempt_at = EXCLUDED.next_attempt_at,
        updated_at = now()
      RETURNING attempts, next_attempt_at
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new ProjectionError('Dead-letter write returned no record.', 'database-error');
    }
    return {
      attempts: row.attempts,
      ...(row.next_attempt_at === null ? {} : { nextAttemptAt: dateString(row.next_attempt_at) }),
    };
  }

  async resolveDeadLetter(
    networkId: string,
    transactionSignature: string,
    logIndex: number,
  ): Promise<void> {
    await this.#sql`
      DELETE FROM indexer_dead_letters
      WHERE network_id = ${networkId}
        AND transaction_signature = ${transactionSignature}
        AND log_index = ${logIndex}
    `;
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}

async function requirePaymentConfigRow(
  sql: TransactionSql,
  networkId: string,
  programId: string,
  paymentConfigAddress: string,
): Promise<PaymentConfigRow> {
  const rows = await sql<PaymentConfigRow[]>`
    SELECT *
    FROM payment_configs
    WHERE network_id = ${networkId}
      AND payment_config_address = ${paymentConfigAddress}
    FOR UPDATE
  `;
  const row = rows[0];
  if (
    row === undefined ||
    !programMatchesNetwork(networkId, programId) ||
    paymentConfigAddress !== (await derivePaymentConfigAddress(programId))
  ) {
    throw stale('Payment event does not match the canonical indexed payment configuration.');
  }
  return row;
}

async function requirePaymentIdentity(
  sql: TransactionSql,
  networkId: string,
  identityId: string,
): Promise<IdentityRow> {
  const rows = await sql<IdentityRow[]>`
    SELECT *
    FROM identities
    WHERE network_id = ${networkId}
      AND identity_id = ${identityId}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new ProjectionError(`Identity ${identityId} has not been indexed.`, 'missing-identity');
  }
  return row;
}

async function requirePaymentSplits(
  sql: TransactionSql,
  networkId: string,
  splits: readonly {
    readonly recipientIdentityId: string;
    readonly destination: string;
    readonly basisPoints: number;
  }[],
): Promise<readonly PaymentRecipientSplitProjection[]> {
  return Promise.all(
    splits.map(async (split) => {
      const identity = await requirePaymentIdentity(sql, networkId, split.recipientIdentityId);
      if (identity.root_authority !== split.destination) {
        throw stale('Payment split recipient does not match an indexed current root authority.');
      }
      return {
        recipientIdentityId: split.recipientIdentityId,
        destination: split.destination,
        basisPoints: split.basisPoints,
      };
    }),
  );
}

async function selectOfferingSplits(
  sql: Sql,
  networkId: string,
  offeringAddress: string,
): Promise<readonly PaymentRecipientSplitProjection[]> {
  const rows = await sql<PaymentSplitRow[]>`
    SELECT recipient_identity_id, destination, basis_points
    FROM subscription_offering_splits
    WHERE network_id = ${networkId}
      AND offering_address = ${offeringAddress}
    ORDER BY split_index
  `;
  return rows.map(paymentSplitFromRow);
}

async function selectOfferingSplitsInTransaction(
  sql: TransactionSql,
  networkId: string,
  offeringAddress: string,
): Promise<readonly PaymentRecipientSplitProjection[]> {
  const rows = await sql<PaymentSplitRow[]>`
    SELECT recipient_identity_id, destination, basis_points
    FROM subscription_offering_splits
    WHERE network_id = ${networkId}
      AND offering_address = ${offeringAddress}
    ORDER BY split_index
  `;
  return rows.map(paymentSplitFromRow);
}

async function selectReceiptAllocations(
  sql: Sql,
  networkId: string,
  receiptAddress: string,
): Promise<readonly PaymentReceiptAllocationRow[]> {
  return sql<PaymentReceiptAllocationRow[]>`
    SELECT recipient_identity_id, destination, basis_points, amount_lamports
    FROM payment_receipt_allocations
    WHERE network_id = ${networkId}
      AND receipt_address = ${receiptAddress}
    ORDER BY split_index
  `;
}

type PaymentSettlementEvent = Extract<
  ProtocolEvent,
  { readonly type: 'woke-tip-settled' | 'subscription-settled' }
>;

async function insertPaymentReceipt(
  sql: TransactionSql,
  event: PaymentSettlementEvent,
  input: {
    readonly termsReference: string;
    readonly subjectIdentityId: string;
    readonly primaryRecipientDestination: string;
    readonly termsStateSequence: bigint;
    readonly termsManifestHash: string;
    readonly recipientSplits: readonly PaymentRecipientSplitProjection[];
    readonly recipientAmounts: readonly bigint[];
    readonly refundPolicyHash: string;
    readonly entitlementFromTimestamp: bigint;
    readonly entitlementUntilTimestamp: bigint;
  },
): Promise<void> {
  if (input.recipientSplits.length !== input.recipientAmounts.length) {
    throw stale('Payment receipt split and amount counts do not match.');
  }
  const created = await sql`
    INSERT INTO payment_receipts (
      network_id, receipt_address, payment_config_address, terms_reference,
      payer_identity_id, payer_authority, subject_identity_id,
      primary_recipient_destination, receipt_nonce, payment_kind,
      payment_policy_sequence, terms_state_sequence, terms_manifest_hash,
      payer_root_rotation_count, gross_lamports, fee_bps, fee_destination,
      fee_lamports, distributable_lamports, refund_policy_hash,
      entitlement_from_timestamp, entitlement_until_timestamp,
      paid_at_timestamp, paid_at_slot, recorded_at,
      transaction_signature, transaction_index, log_index
    ) VALUES (
      ${event.networkId}, ${event.receiptAddress}, ${event.paymentConfigAddress},
      ${input.termsReference}, ${event.payerIdentityId}, ${event.payerAuthority},
      ${input.subjectIdentityId}, ${input.primaryRecipientDestination},
      ${event.receiptNonce}, ${event.paymentKind}, ${event.paymentPolicySequence.toString()},
      ${input.termsStateSequence.toString()}, ${input.termsManifestHash},
      ${event.payerRootRotationCount.toString()}, ${event.grossLamports.toString()},
      ${event.feeBps}, ${event.feeDestination}, ${event.feeLamports.toString()},
      ${event.distributableLamports.toString()}, ${input.refundPolicyHash},
      ${input.entitlementFromTimestamp.toString()},
      ${input.entitlementUntilTimestamp.toString()}, ${event.paidAtTimestamp.toString()},
      ${event.slot.toString()}, ${event.blockTime}, ${event.transactionSignature},
      ${event.transactionIndex ?? null}, ${event.logIndex}
    )
    ON CONFLICT DO NOTHING
    RETURNING receipt_address
  `;
  if (created.length !== 1) {
    throw stale('Payment receipt address or payer nonce was already projected.');
  }
  for (const [index, split] of input.recipientSplits.entries()) {
    const amount = input.recipientAmounts[index];
    if (amount === undefined) {
      throw stale('Payment receipt allocation is incomplete.');
    }
    await sql`
      INSERT INTO payment_receipt_allocations (
        network_id, receipt_address, split_index, recipient_identity_id,
        destination, basis_points, amount_lamports
      ) VALUES (
        ${event.networkId}, ${event.receiptAddress}, ${index},
        ${split.recipientIdentityId}, ${split.destination},
        ${split.basisPoints}, ${amount.toString()}
      )
    `;
  }
}

function paymentNonce(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'hex'));
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

interface IdentityRow {
  identity_id: string;
  network_id: string;
  identity_address: string;
  root_authority: string;
  root_rotation_count: string;
  created_slot: string;
  created_at: Date | string;
  updated_slot: string;
  updated_at: Date | string;
}

interface ProtocolConfigRow {
  network_id: string;
  config_address: string;
  initialized_slot: string;
  initialized_at: Date | string;
}

interface RootHistoryRow {
  identity_id: string;
  rotation_count: string;
  authority: string;
  from_slot: string;
  from_transaction_index: number | null;
  from_transaction_signature: string;
  from_log_index: number;
}

interface DelegationRow {
  delegation_address: string;
  network_id: string;
  identity_id: string;
  delegate_authority: string;
  delegation_sequence: string;
  identity_sequence: string;
  scopes: number;
  issued_at_root_rotation_count: string;
  issued_at_slot: string;
  expires_at_slot: string;
  state_sequence: string;
  revoked_at_slot: string | null;
  created_transaction_index: number | null;
  created_transaction_signature: string;
  created_log_index: number;
  revoked_transaction_index: number | null;
  revoked_transaction_signature: string | null;
  revoked_log_index: number | null;
  updated_at: Date | string;
}

interface HandleRow {
  network_id: string;
  handle_claim_address: string;
  handle: string;
  handle_hash: string;
  identity_id: string;
  authority: string;
  identity_sequence: string;
  active: boolean;
  claimed_slot: string;
  claimed_at: Date | string;
  released_slot: string | null;
  released_at: Date | string | null;
}

interface BlockRow {
  network_id: string;
  block_edge_address: string;
  blocker_identity_id: string;
  subject_identity_id: string;
  authority: string;
  blocker_sequence: string;
  state_sequence: string;
  active: boolean;
  updated_slot: string;
  updated_at: Date | string;
}

interface CommunityRow {
  network_id: string;
  community_address: string;
  creator_identity_id: string;
  authority: string;
  creator_sequence: string;
  manifest_cid: string;
  manifest_hash: string;
  manifest_verified: false;
  governance_version: number;
  governance_strategy_hash: string;
  created_slot: string;
  created_at: Date | string;
  updated_slot: string;
  updated_at: Date | string;
}

interface CommunityMembershipRow {
  network_id: string;
  community_address: string;
  membership_address: string;
  member_identity_id: string;
  assigned_by_identity_id: string;
  authority: string;
  authority_sequence: string;
  state_sequence: string;
  roles: number;
  active: boolean;
  updated_slot: string;
  updated_at: Date | string;
}

interface ReactionRow {
  network_id: string;
  reaction_reference: string;
  reactor_identity_id: string;
  target_post_reference: string;
  authority: string;
  reaction_kind: number;
  reactor_sequence: string;
  state_sequence: string;
  active: boolean;
  updated_slot: string;
  updated_at: Date | string;
}

interface RecoveryPolicyRow {
  recovery_policy_address: string;
  network_id: string;
  identity_id: string;
  root_authority: string;
  policy_sequence: string;
  identity_sequence: string;
  root_rotation_count: string;
  guardians: string[];
  threshold: number;
  delay_slots: string;
  active: boolean;
  updated_slot: string;
  updated_at: Date | string;
}

interface RecoveryRequestRow {
  recovery_request_address: string;
  network_id: string;
  identity_id: string;
  recovery_policy_address: string;
  request_nonce: string;
  policy_sequence: string;
  current_root_authority: string;
  identity_sequence: string;
  root_rotation_count: string;
  target_root_authority: string;
  requesting_guardian: string;
  guardians: string[];
  threshold: number;
  guardian_count: number;
  approvals_mask: number;
  approved_guardians: string[];
  approval_count: number;
  requested_slot: string;
  requested_at: Date | string;
  execute_after_slot: string;
  state: 'pending' | 'cancelled' | 'executed';
  updated_slot: string;
  updated_at: Date | string;
  terminal_identity_sequence: string | null;
  terminal_root_rotation_count: string | null;
  terminal_slot: string | null;
  terminal_at: Date | string | null;
  cancelled_by_root_authority: string | null;
  executor: string | null;
}

interface LatestSequenceRow {
  identity_sequence: string | null;
}

interface ProtocolEventRow {
  event_type: string;
  event_body: Readonly<Record<string, string | undefined>>;
  slot: string;
  transaction_index: number | null;
  log_index: number;
}

interface GovernanceProposalRow {
  proposal_address: string;
  network_id: string;
  community_address: string;
  proposer_identity_id: string;
  authority: string;
  proposer_sequence: string;
  previous_community_sequence: string;
  manifest_hash: string;
  manifest_uri: string;
  manifest_verified: false;
  governance_version: number;
  governance_strategy_hash: string;
  voting_model: 'one-active-member-one-vote';
  eligible_member_count: string;
  opens_at_slot: string;
  closes_at_slot: string;
  quorum_bps: 5000;
  approval_bps: 5001;
  yes_votes: string;
  no_votes: string;
  abstain_votes: string;
  state_sequence: string;
  outcome: 'pending' | 'accepted' | 'rejected';
  created_slot: string;
  created_at: Date | string;
  finalizer: string | null;
  participating_votes: string | null;
  decisive_votes: string | null;
  quorum_met: boolean | null;
  approval_met: boolean | null;
  finalized_slot: string | null;
  finalized_at: Date | string | null;
}

interface GovernanceVoteRow {
  vote_address: string;
  network_id: string;
  community_address: string;
  proposal_address: string;
  voter_identity_id: string;
  membership_address: string;
  authority: string;
  voter_sequence: string;
  membership_state_sequence: string;
  proposal_state_sequence: string;
  choice: 'yes' | 'no' | 'abstain';
  yes_votes: string;
  no_votes: string;
  abstain_votes: string;
  cast_slot: string;
  cast_at: Date | string;
}

interface PaymentConfigRow {
  network_id: string;
  payment_config_address: string;
  upgrade_authority: string;
  authority: string;
  fee_destination: string;
  fee_bps: number;
  policy_sequence: string;
  enabled: boolean;
  initialized_slot: string;
  initialized_at: Date | string;
  updated_slot: string;
  updated_at: Date | string;
  transaction_signature: string;
  transaction_index: number | null;
  log_index: number;
}

interface SubscriptionOfferingRow {
  network_id: string;
  offering_address: string;
  payment_config_address: string;
  creator_identity_id: string;
  root_authority: string;
  offering_nonce: string;
  manifest_hash: string;
  manifest_uri: string;
  price_lamports: string;
  billing_interval: 'week';
  refund_policy_hash: string;
  max_protocol_fee_bps: number;
  creator_root_rotation_count: string;
  creator_sequence: string;
  state_sequence: string;
  active: boolean;
  created_slot: string;
  created_at: Date | string;
  updated_slot: string;
  updated_at: Date | string;
  retired_slot: string | null;
  retired_at: Date | string | null;
  transaction_signature: string;
  transaction_index: number | null;
  log_index: number;
}

interface PaymentSplitRow {
  recipient_identity_id: string;
  destination: string;
  basis_points: number;
}

interface PaymentReceiptRow {
  network_id: string;
  receipt_address: string;
  payment_config_address: string;
  terms_reference: string;
  payer_identity_id: string;
  payer_authority: string;
  subject_identity_id: string;
  primary_recipient_destination: string;
  receipt_nonce: string;
  payment_kind: PaymentReceiptProjection['paymentKind'];
  payment_policy_sequence: string;
  terms_state_sequence: string;
  terms_manifest_hash: string;
  payer_root_rotation_count: string;
  gross_lamports: string;
  fee_bps: number;
  fee_destination: string;
  fee_lamports: string;
  distributable_lamports: string;
  refund_policy_hash: string;
  entitlement_from_timestamp: string;
  entitlement_until_timestamp: string;
  paid_at_timestamp: string;
  paid_at_slot: string;
  recorded_at: Date | string;
  transaction_signature: string;
  transaction_index: number | null;
  log_index: number;
}

interface PaymentReceiptAllocationRow extends PaymentSplitRow {
  amount_lamports: string;
}

interface SubscriptionEntitlementRow {
  network_id: string;
  entitlement_address: string;
  offering_address: string;
  beneficiary_identity_id: string;
  started_at_timestamp: string;
  valid_until_timestamp: string;
  settlement_count: string;
  last_receipt_address: string;
  state_sequence: string;
  last_settled_at_slot: string;
  refund_policy_hash: string;
  recorded_at: Date | string;
  transaction_signature: string;
  transaction_index: number | null;
  log_index: number;
}

interface ProfileRow {
  identity_id: string;
  object_id: string;
  cid: string;
  payload_hash: string;
  display_name: string;
  bio: string;
  pronouns: ProfileProjection['content']['pronouns'];
  updated_slot: string;
  updated_at: Date | string;
}

interface PostRow {
  object_id: string;
  network_id: string;
  author_identity_id: string;
  cid: string;
  payload_hash: string;
  signing_key_id: string;
  body: string | null;
  language: string;
  content: PostProjection['content'];
  created_at: Date | string;
  anchored_slot: string;
  transaction_signature: string;
  verified: boolean;
  tombstoned_at: Date | string | null;
}

interface FeedRow extends PostRow {
  identity_address: string;
  root_authority: string;
  root_rotation_count: string;
  created_slot: string;
  identity_created_at: Date | string;
  identity_updated_slot: string;
  identity_updated_at: Date | string;
  profile_object_id: string | null;
  profile_cid: string | null;
  profile_payload_hash: string | null;
  display_name: string | null;
  bio: string | null;
  pronouns: ProfileProjection['content']['pronouns'] | null;
  updated_slot: string | null;
  updated_at: Date | string | null;
}

function identityFromRow(row: IdentityRow): IdentityProjection {
  return {
    identityId: row.identity_id,
    networkId: row.network_id,
    identityAddress: row.identity_address,
    rootAuthority: row.root_authority,
    rootRotationCount: BigInt(row.root_rotation_count),
    createdSlot: BigInt(row.created_slot),
    createdAt: dateString(row.created_at),
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function delegationFromRow(row: DelegationRow): DelegationProjection {
  return {
    identityId: row.identity_id,
    delegationAddress: row.delegation_address,
    delegateAuthority: row.delegate_authority,
    delegationSequence: BigInt(row.delegation_sequence),
    identitySequence: BigInt(row.identity_sequence),
    scopes: row.scopes,
    issuedAtRootRotationCount: BigInt(row.issued_at_root_rotation_count),
    issuedAtSlot: BigInt(row.issued_at_slot),
    expiresAtSlot: BigInt(row.expires_at_slot),
    stateSequence: BigInt(row.state_sequence),
    ...(row.revoked_at_slot === null ? {} : { revokedAtSlot: BigInt(row.revoked_at_slot) }),
    updatedAt: dateString(row.updated_at),
  };
}

function handleFromRow(row: HandleRow): HandleProjection {
  return {
    networkId: row.network_id,
    handleClaimAddress: row.handle_claim_address,
    identityId: row.identity_id,
    authority: row.authority,
    identitySequence: BigInt(row.identity_sequence),
    handleHash: row.handle_hash,
    handle: row.handle,
    claimedSlot: BigInt(row.claimed_slot),
    claimedAt: dateString(row.claimed_at),
  };
}

function blockFromRow(row: BlockRow): BlockProjection {
  return {
    blockEdgeAddress: row.block_edge_address,
    blockerIdentityId: row.blocker_identity_id,
    subjectIdentityId: row.subject_identity_id,
    authority: row.authority,
    blockerSequence: BigInt(row.blocker_sequence),
    stateSequence: BigInt(row.state_sequence),
    active: row.active,
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function communityFromRow(row: CommunityRow): CommunityProjection {
  return {
    networkId: row.network_id,
    communityAddress: row.community_address,
    creatorIdentityId: row.creator_identity_id,
    authority: row.authority,
    creatorSequence: BigInt(row.creator_sequence),
    manifestCid: row.manifest_cid,
    manifestHash: row.manifest_hash,
    manifestVerified: false,
    governanceVersion: row.governance_version,
    governanceStrategyHash: row.governance_strategy_hash,
    createdSlot: BigInt(row.created_slot),
    createdAt: dateString(row.created_at),
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function membershipFromRow(row: CommunityMembershipRow): CommunityMembershipProjection {
  return {
    networkId: row.network_id,
    communityAddress: row.community_address,
    membershipAddress: row.membership_address,
    memberIdentityId: row.member_identity_id,
    assignedByIdentityId: row.assigned_by_identity_id,
    authority: row.authority,
    authoritySequence: BigInt(row.authority_sequence),
    stateSequence: BigInt(row.state_sequence),
    roles: row.roles,
    active: row.active,
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function reactionFromRow(row: ReactionRow): ReactionProjection {
  return {
    networkId: row.network_id,
    reactionReference: row.reaction_reference,
    reactorIdentityId: row.reactor_identity_id,
    targetPostReference: row.target_post_reference,
    authority: row.authority,
    reactionKind: row.reaction_kind,
    reactorSequence: BigInt(row.reactor_sequence),
    stateSequence: BigInt(row.state_sequence),
    active: row.active,
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function recoveryPolicyFromRow(row: RecoveryPolicyRow): RecoveryPolicyProjection {
  return {
    networkId: row.network_id,
    identityId: row.identity_id,
    recoveryPolicyAddress: row.recovery_policy_address,
    rootAuthority: row.root_authority,
    policySequence: BigInt(row.policy_sequence),
    identitySequence: BigInt(row.identity_sequence),
    rootRotationCount: BigInt(row.root_rotation_count),
    guardians: row.guardians,
    threshold: row.threshold,
    delaySlots: BigInt(row.delay_slots),
    active: row.active,
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function recoveryRequestFromRow(row: RecoveryRequestRow): RecoveryRequestProjection {
  const request: RecoveryRequestProjection = {
    networkId: row.network_id,
    identityId: row.identity_id,
    recoveryPolicyAddress: row.recovery_policy_address,
    recoveryRequestAddress: row.recovery_request_address,
    requestNonce: row.request_nonce,
    policySequence: BigInt(row.policy_sequence),
    currentRootAuthority: row.current_root_authority,
    identitySequence: BigInt(row.identity_sequence),
    rootRotationCount: BigInt(row.root_rotation_count),
    targetRootAuthority: row.target_root_authority,
    requestingGuardian: row.requesting_guardian,
    guardians: row.guardians,
    threshold: row.threshold,
    guardianCount: row.guardian_count,
    approvalsMask: row.approvals_mask,
    approvedGuardians: row.approved_guardians,
    approvalCount: row.approval_count,
    requestedSlot: BigInt(row.requested_slot),
    requestedAt: dateString(row.requested_at),
    executeAfterSlot: BigInt(row.execute_after_slot),
    state: row.state,
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
  if (
    row.terminal_identity_sequence === null ||
    row.terminal_root_rotation_count === null ||
    row.terminal_slot === null ||
    row.terminal_at === null
  ) {
    return request;
  }
  return {
    ...request,
    terminalIdentitySequence: BigInt(row.terminal_identity_sequence),
    terminalRootRotationCount: BigInt(row.terminal_root_rotation_count),
    terminalSlot: BigInt(row.terminal_slot),
    terminalAt: dateString(row.terminal_at),
    ...(row.cancelled_by_root_authority === null
      ? {}
      : { cancelledByRootAuthority: row.cancelled_by_root_authority }),
    ...(row.executor === null ? {} : { executor: row.executor }),
  };
}

function governanceProposalFromRow(row: GovernanceProposalRow): GovernanceProposalProjection {
  const proposal: GovernanceProposalProjection = {
    networkId: row.network_id,
    communityAddress: row.community_address,
    proposalAddress: row.proposal_address,
    proposerIdentityId: row.proposer_identity_id,
    authority: row.authority,
    proposerSequence: BigInt(row.proposer_sequence),
    previousCommunitySequence: BigInt(row.previous_community_sequence),
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    manifestVerified: false,
    governanceVersion: row.governance_version,
    governanceStrategyHash: row.governance_strategy_hash,
    votingModel: row.voting_model,
    eligibleMemberCount: BigInt(row.eligible_member_count),
    opensAtSlot: BigInt(row.opens_at_slot),
    closesAtSlot: BigInt(row.closes_at_slot),
    quorumBps: row.quorum_bps,
    approvalBps: row.approval_bps,
    yesVotes: BigInt(row.yes_votes),
    noVotes: BigInt(row.no_votes),
    abstainVotes: BigInt(row.abstain_votes),
    stateSequence: BigInt(row.state_sequence),
    outcome: row.outcome,
    createdSlot: BigInt(row.created_slot),
    createdAt: dateString(row.created_at),
  };
  if (
    row.finalizer === null ||
    row.participating_votes === null ||
    row.decisive_votes === null ||
    row.quorum_met === null ||
    row.approval_met === null ||
    row.finalized_slot === null ||
    row.finalized_at === null
  ) {
    return proposal;
  }
  return {
    ...proposal,
    finalizer: row.finalizer,
    participatingVotes: BigInt(row.participating_votes),
    decisiveVotes: BigInt(row.decisive_votes),
    quorumMet: row.quorum_met,
    approvalMet: row.approval_met,
    finalizedSlot: BigInt(row.finalized_slot),
    finalizedAt: dateString(row.finalized_at),
  };
}

function governanceVoteFromRow(row: GovernanceVoteRow): GovernanceVoteProjection {
  return {
    networkId: row.network_id,
    communityAddress: row.community_address,
    proposalAddress: row.proposal_address,
    voteAddress: row.vote_address,
    voterIdentityId: row.voter_identity_id,
    membershipAddress: row.membership_address,
    authority: row.authority,
    voterSequence: BigInt(row.voter_sequence),
    membershipStateSequence: BigInt(row.membership_state_sequence),
    proposalStateSequence: BigInt(row.proposal_state_sequence),
    choice: row.choice,
    yesVotes: BigInt(row.yes_votes),
    noVotes: BigInt(row.no_votes),
    abstainVotes: BigInt(row.abstain_votes),
    castSlot: BigInt(row.cast_slot),
    castAt: dateString(row.cast_at),
  };
}

function paymentConfigFromRow(row: PaymentConfigRow): PaymentConfigProjection {
  return {
    networkId: row.network_id,
    paymentConfigAddress: row.payment_config_address,
    upgradeAuthority: row.upgrade_authority,
    authority: row.authority,
    feeDestination: row.fee_destination,
    feeBps: row.fee_bps,
    policySequence: BigInt(row.policy_sequence),
    enabled: row.enabled,
    initializedSlot: BigInt(row.initialized_slot),
    initializedAt: dateString(row.initialized_at),
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
    ...paymentRowProvenance(row),
  };
}

function subscriptionOfferingFromRow(
  row: SubscriptionOfferingRow,
  recipientSplits: readonly PaymentRecipientSplitProjection[],
): SubscriptionOfferingProjection {
  return {
    networkId: row.network_id,
    offeringAddress: row.offering_address,
    paymentConfigAddress: row.payment_config_address,
    creatorIdentityId: row.creator_identity_id,
    rootAuthority: row.root_authority,
    offeringNonce: row.offering_nonce,
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    manifestVerified: false,
    priceLamports: BigInt(row.price_lamports),
    billingInterval: row.billing_interval,
    recipientSplits,
    refundPolicyHash: row.refund_policy_hash,
    maxProtocolFeeBps: row.max_protocol_fee_bps,
    creatorRootRotationCount: BigInt(row.creator_root_rotation_count),
    creatorSequence: BigInt(row.creator_sequence),
    stateSequence: BigInt(row.state_sequence),
    active: row.active,
    createdSlot: BigInt(row.created_slot),
    createdAt: dateString(row.created_at),
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
    ...(row.retired_slot === null || row.retired_at === null
      ? {}
      : {
          retiredSlot: BigInt(row.retired_slot),
          retiredAt: dateString(row.retired_at),
        }),
    ...paymentRowProvenance(row),
  };
}

function paymentReceiptFromRow(
  row: PaymentReceiptRow,
  allocations: readonly PaymentReceiptAllocationRow[],
): PaymentReceiptProjection {
  return {
    networkId: row.network_id,
    receiptAddress: row.receipt_address,
    paymentConfigAddress: row.payment_config_address,
    termsReference: row.terms_reference,
    payerIdentityId: row.payer_identity_id,
    payerAuthority: row.payer_authority,
    subjectIdentityId: row.subject_identity_id,
    primaryRecipientDestination: row.primary_recipient_destination,
    receiptNonce: row.receipt_nonce,
    paymentKind: row.payment_kind,
    paymentPolicySequence: BigInt(row.payment_policy_sequence),
    termsStateSequence: BigInt(row.terms_state_sequence),
    termsManifestHash: row.terms_manifest_hash,
    payerRootRotationCount: BigInt(row.payer_root_rotation_count),
    grossLamports: BigInt(row.gross_lamports),
    feeBps: row.fee_bps,
    feeDestination: row.fee_destination,
    feeLamports: BigInt(row.fee_lamports),
    distributableLamports: BigInt(row.distributable_lamports),
    recipientSplits: allocations.map(paymentSplitFromRow),
    recipientAmounts: allocations.map((allocation) => BigInt(allocation.amount_lamports)),
    refundPolicyHash: row.refund_policy_hash,
    entitlementFromTimestamp: BigInt(row.entitlement_from_timestamp),
    entitlementUntilTimestamp: BigInt(row.entitlement_until_timestamp),
    paidAtTimestamp: BigInt(row.paid_at_timestamp),
    paidAtSlot: BigInt(row.paid_at_slot),
    recordedAt: dateString(row.recorded_at),
    ...paymentRowProvenance(row),
  };
}

function subscriptionEntitlementFromRow(
  row: SubscriptionEntitlementRow,
): SubscriptionEntitlementProjection {
  return {
    networkId: row.network_id,
    entitlementAddress: row.entitlement_address,
    offeringAddress: row.offering_address,
    beneficiaryIdentityId: row.beneficiary_identity_id,
    startedAtTimestamp: BigInt(row.started_at_timestamp),
    validUntilTimestamp: BigInt(row.valid_until_timestamp),
    settlementCount: BigInt(row.settlement_count),
    lastReceiptAddress: row.last_receipt_address,
    stateSequence: BigInt(row.state_sequence),
    lastSettledAtSlot: BigInt(row.last_settled_at_slot),
    refundPolicyHash: row.refund_policy_hash,
    recordedAt: dateString(row.recorded_at),
    ...paymentRowProvenance(row),
  };
}

function paymentSplitFromRow(row: PaymentSplitRow): PaymentRecipientSplitProjection {
  return {
    recipientIdentityId: row.recipient_identity_id,
    destination: row.destination,
    basisPoints: row.basis_points,
  };
}

function paymentRowProvenance(row: {
  readonly transaction_signature: string;
  readonly transaction_index: number | null;
  readonly log_index: number;
}) {
  return {
    transactionSignature: row.transaction_signature,
    ...(row.transaction_index === null ? {} : { transactionIndex: row.transaction_index }),
    logIndex: row.log_index,
  };
}

function profileFromRow(row: ProfileRow): ProfileProjection {
  return {
    identityId: row.identity_id,
    objectId: row.object_id,
    cid: row.cid,
    payloadHash: row.payload_hash,
    content: {
      displayName: row.display_name,
      bio: row.bio,
      pronouns: row.pronouns,
      genderVisibility: 'private',
      chosenFamilyLabels: [],
      links: [],
    },
    updatedSlot: BigInt(row.updated_slot),
    updatedAt: dateString(row.updated_at),
  };
}

function postFromRow(row: PostRow): PostProjection {
  const post: PostProjection = {
    objectId: row.object_id,
    networkId: row.network_id,
    authorIdentityId: row.author_identity_id,
    cid: row.cid,
    payloadHash: row.payload_hash,
    signingKeyId: row.signing_key_id,
    content: row.content,
    createdAt: dateString(row.created_at),
    anchoredSlot: BigInt(row.anchored_slot),
    transactionSignature: row.transaction_signature,
    verified: true,
  };
  return row.tombstoned_at === null
    ? post
    : { ...post, tombstonedAt: dateString(row.tombstoned_at) };
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function serializeEvent(event: ProtocolEvent): postgres.JSONValue {
  return toJsonValue(event);
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

function eventKey(event: ProtocolEvent): string {
  return eventKeyParts(event.networkId, event.transactionSignature, event.logIndex);
}

function eventKeyParts(networkId: string, transactionSignature: string, logIndex: number): string {
  return `${networkId}\u0000${transactionSignature}\u0000${logIndex}`;
}

function toJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as postgres.JSONValue;
}

interface EventPosition {
  readonly slot: bigint;
  readonly transactionIndex?: number;
  readonly transactionSignature: string;
  readonly logIndex: number;
}

function positionFor(value: SigningKeyAuthorizationQuery): EventPosition {
  return {
    slot: value.slot,
    ...(value.transactionIndex === undefined ? {} : { transactionIndex: value.transactionIndex }),
    transactionSignature: value.transactionSignature,
    logIndex: value.logIndex,
  };
}

function rootPosition(row: RootHistoryRow): EventPosition {
  return {
    slot: BigInt(row.from_slot),
    ...(row.from_transaction_index === null
      ? {}
      : { transactionIndex: row.from_transaction_index }),
    transactionSignature: row.from_transaction_signature,
    logIndex: row.from_log_index,
  };
}

function delegationCreatedPosition(row: DelegationRow): EventPosition {
  return {
    slot: BigInt(row.issued_at_slot),
    ...(row.created_transaction_index === null
      ? {}
      : { transactionIndex: row.created_transaction_index }),
    transactionSignature: row.created_transaction_signature,
    logIndex: row.created_log_index,
  };
}

function delegationRevokedPosition(row: DelegationRow): EventPosition | undefined {
  if (
    row.revoked_at_slot === null ||
    row.revoked_transaction_signature === null ||
    row.revoked_log_index === null
  ) {
    return undefined;
  }
  return {
    slot: BigInt(row.revoked_at_slot),
    ...(row.revoked_transaction_index === null
      ? {}
      : { transactionIndex: row.revoked_transaction_index }),
    transactionSignature: row.revoked_transaction_signature,
    logIndex: row.revoked_log_index,
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
  const signature = left.transactionSignature.localeCompare(right.transactionSignature);
  return signature === 0 ? left.logIndex - right.logIndex : signature;
}

function scopeForObjectType(objectType: string): number | undefined {
  if (objectType === 'profile') return 1 << 0;
  if (objectType === 'post') return 1 << 1;
  return undefined;
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

function projectionError(error: unknown): ProjectionError {
  return error instanceof ProjectionError
    ? error
    : new ProjectionError('PostgreSQL projection update failed.', 'database-error', {
        cause: error,
      });
}

function programMatchesNetwork(networkId: string, programId: string): boolean {
  return networkId.split(':').at(-1) === programId;
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
  return manifest;
}
