import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import bs58 from 'bs58';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const governanceStrategyHash = 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA';

describe('0008 and 0009 network-scope migrations', () => {
  it('upgrade a populated 0007 schema and reject cross-network references', async () => {
    const schema = `indexer_0008_${randomBytes(8).toString('hex')}`;
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const programId = publicKey();
    const networkOne = `wokenet:v1:${publicKey()}:${programId}`;
    const networkTwo = `wokenet:v1:${publicKey()}:${programId}`;
    const identityAddress = publicKey();
    const subjectIdentityAddress = publicKey();
    const identityOne = `wokesocialid:v1:${networkOne}:${identityAddress}`;
    const identityTwo = `wokesocialid:v1:${networkTwo}:${identityAddress}`;
    const subjectIdentityOne = `wokesocialid:v1:${networkOne}:${subjectIdentityAddress}`;
    const subjectIdentityTwo = `wokesocialid:v1:${networkTwo}:${subjectIdentityAddress}`;
    const rootAuthority = publicKey();
    const targetRootAuthority = publicKey();
    const guardianOne = publicKey();
    const guardianTwo = publicKey();
    const communityAddress = publicKey();
    const membershipAddress = publicKey();
    const delegationAddress = publicKey();
    const blockEdgeAddress = publicKey();
    const reactionReference = publicKey();
    const postReference = publicKey();
    const proposalAddress = publicKey();
    const voteAddress = publicKey();
    const recoveryPolicyAddress = publicKey();
    const recoveryRequestAddress = publicKey();
    const now = new Date('2026-07-28T20:00:00.000Z');

    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`SET search_path TO "${schema}"`);
      const migrationFiles = (await readdir(migrationDirectory))
        .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
        .sort();
      const migration0008 = migrationFiles.find((file) => file.startsWith('0008_'));
      const migration0009 = migrationFiles.find((file) => file.startsWith('0009_'));
      expect(migration0008).toBeDefined();
      expect(migration0009).toBeDefined();
      for (const file of migrationFiles.filter((candidate) => candidate < (migration0008 ?? ''))) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }

      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        )
        VALUES
          (${identityOne}, ${networkOne}, ${identityAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now}),
          (${identityTwo}, ${networkTwo}, ${identityAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now}),
          (${subjectIdentityOne}, ${networkOne}, ${subjectIdentityAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now}),
          (${subjectIdentityTwo}, ${networkTwo}, ${subjectIdentityAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now})
      `;
      await sql`
        INSERT INTO delegations (
          delegation_address, identity_id, delegate_authority, delegation_sequence,
          identity_sequence, scopes, issued_at_root_rotation_count, issued_at_slot,
          expires_at_slot, state_sequence, created_transaction_signature,
          created_log_index, updated_at
        )
        VALUES (
          ${delegationAddress}, ${identityOne}, ${guardianOne}, 1,
          1, 1, 0, 2, 100, 1, 'legacy-delegation-signature', 0, ${now}
        )
      `;
      await sql`
        INSERT INTO blocks (
          blocker_identity_id, subject_identity_id, block_edge_address, authority,
          blocker_sequence, state_sequence, active, updated_slot, updated_at
        )
        VALUES (
          ${identityOne}, ${subjectIdentityOne}, ${blockEdgeAddress}, ${rootAuthority},
          2, 1, true, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO communities (
          community_address, network_id, creator_identity_id, authority, creator_sequence,
          manifest_cid, manifest_hash, governance_version, governance_strategy_hash,
          created_slot, created_at, updated_slot, updated_at
        )
        VALUES (
          ${communityAddress}, ${networkOne}, ${identityOne}, ${rootAuthority}, 1,
          'bafylegacycommunitymanifest', 'uLegacyCommunityManifestHash', 1,
          ${governanceStrategyHash}, 2, ${now}, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO community_governance_history (
          community_address, governance_version, strategy_hash, authority,
          creator_sequence, updated_slot, updated_at
        )
        VALUES (
          ${communityAddress}, 1, ${governanceStrategyHash}, ${rootAuthority}, 1, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO community_memberships (
          community_address, member_identity_id, membership_address, assigned_by_identity_id,
          authority, authority_sequence, state_sequence, roles, active, updated_slot, updated_at
        )
        VALUES (
          ${communityAddress}, ${identityOne}, ${membershipAddress}, ${identityOne},
          ${rootAuthority}, 2, 1, 1, true, 3, ${now}
        )
      `;
      await sql`
        INSERT INTO reactions (
          network_id, reactor_identity_id, target_post_reference, reaction_kind,
          reaction_reference, authority, reactor_sequence, state_sequence,
          active, updated_slot, updated_at
        )
        VALUES (
          ${networkOne}, ${identityOne}, ${postReference}, 1,
          ${reactionReference}, ${rootAuthority}, 3, 1, true, 3, ${now}
        )
      `;
      await sql`
        INSERT INTO governance_proposals (
          proposal_address, network_id, community_address, proposer_identity_id, authority,
          proposer_sequence, previous_community_sequence, manifest_hash, manifest_uri,
          governance_version, governance_strategy_hash, voting_model, eligible_member_count,
          opens_at_slot, closes_at_slot, quorum_bps, approval_bps, state_sequence, outcome,
          created_slot, created_at
        )
        VALUES (
          ${proposalAddress}, ${networkOne}, ${communityAddress}, ${identityOne}, ${rootAuthority},
          3, 2, 'uLegacyProposalManifestHash', 'local://legacy-proposal', 1,
          ${governanceStrategyHash}, 'one-active-member-one-vote', 1,
          5, 7, 5000, 5001, 1, 'pending', 4, ${now}
        )
      `;
      await sql`
        INSERT INTO governance_votes (
          vote_address, network_id, community_address, proposal_address, voter_identity_id,
          membership_address, authority, voter_sequence, membership_state_sequence,
          proposal_state_sequence, choice, yes_votes, no_votes, abstain_votes,
          cast_slot, cast_at
        )
        VALUES (
          ${voteAddress}, ${networkOne}, ${communityAddress}, ${proposalAddress}, ${identityOne},
          ${membershipAddress}, ${rootAuthority}, 1, 1, 2, 'yes', 1, 0, 0, 5, ${now}
        )
      `;
      await sql`
        INSERT INTO recovery_policies (
          recovery_policy_address, network_id, identity_id, root_authority, policy_sequence,
          identity_sequence, root_rotation_count, guardians, threshold, delay_slots,
          active, updated_slot, updated_at
        )
        VALUES (
          ${recoveryPolicyAddress}, ${networkOne}, ${identityOne}, ${rootAuthority}, 1,
          4, 0, ${sql.json([guardianOne, guardianTwo])}, 2, 2, true, 5, ${now}
        )
      `;
      await sql`
        INSERT INTO recovery_requests (
          recovery_request_address, network_id, identity_id, recovery_policy_address,
          request_nonce, policy_sequence, current_root_authority, identity_sequence,
          root_rotation_count, target_root_authority, requesting_guardian, guardians,
          threshold, guardian_count, approvals_mask, approved_guardians, approval_count,
          requested_slot, requested_at, execute_after_slot, state, updated_slot, updated_at
        )
        VALUES (
          ${recoveryRequestAddress}, ${networkOne}, ${identityOne}, ${recoveryPolicyAddress},
          '00112233445566778899aabbccddeeff', 1, ${rootAuthority}, 4,
          0, ${targetRootAuthority}, ${guardianOne},
          ${sql.json([guardianOne, guardianTwo])}, 2, 2, 1,
          ${sql.json([guardianOne])}, 1, 6, ${now}, 8, 'pending', 6, ${now}
        )
      `;

      await sql.unsafe(await readFile(join(migrationDirectory, migration0008 as string), 'utf8'));

      await expect(
        sql`SELECT network_id FROM community_memberships WHERE membership_address = ${membershipAddress}`,
      ).resolves.toMatchObject([{ network_id: networkOne }]);
      await expect(
        sql`SELECT network_id FROM delegations WHERE delegation_address = ${delegationAddress}`,
      ).resolves.toMatchObject([{ network_id: networkOne }]);
      await expect(
        sql`SELECT network_id FROM blocks WHERE block_edge_address = ${blockEdgeAddress}`,
      ).resolves.toMatchObject([{ network_id: networkOne }]);

      await sql`
        INSERT INTO delegations (
          network_id, delegation_address, identity_id, delegate_authority,
          delegation_sequence, identity_sequence, scopes, issued_at_root_rotation_count,
          issued_at_slot, expires_at_slot, state_sequence, created_transaction_signature,
          created_log_index, updated_at
        )
        VALUES (
          ${networkTwo}, ${delegationAddress}, ${identityTwo}, ${guardianOne},
          1, 1, 1, 0, 2, 100, 1, 'network-two-delegation-signature', 0, ${now}
        )
      `;
      await sql`
        INSERT INTO blocks (
          network_id, blocker_identity_id, subject_identity_id, block_edge_address,
          authority, blocker_sequence, state_sequence, active, updated_slot, updated_at
        )
        VALUES (
          ${networkTwo}, ${identityTwo}, ${subjectIdentityTwo}, ${blockEdgeAddress},
          ${rootAuthority}, 2, 1, true, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO communities (
          community_address, network_id, creator_identity_id, authority, creator_sequence,
          manifest_cid, manifest_hash, governance_version, governance_strategy_hash,
          created_slot, created_at, updated_slot, updated_at
        )
        VALUES (
          ${communityAddress}, ${networkTwo}, ${identityTwo}, ${rootAuthority}, 1,
          'bafynetworktwocommunity', 'uNetworkTwoCommunityManifest', 1,
          ${governanceStrategyHash}, 2, ${now}, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO community_governance_history (
          network_id, community_address, governance_version, strategy_hash, authority,
          creator_sequence, updated_slot, updated_at
        )
        VALUES (
          ${networkTwo}, ${communityAddress}, 1, ${governanceStrategyHash},
          ${rootAuthority}, 1, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO community_memberships (
          network_id, community_address, member_identity_id, membership_address,
          assigned_by_identity_id, authority, authority_sequence, state_sequence,
          roles, active, updated_slot, updated_at
        )
        VALUES (
          ${networkTwo}, ${communityAddress}, ${identityTwo}, ${membershipAddress},
          ${identityTwo}, ${rootAuthority}, 2, 1, 1, true, 3, ${now}
        )
      `;
      await sql`
        INSERT INTO reactions (
          network_id, reactor_identity_id, target_post_reference, reaction_kind,
          reaction_reference, authority, reactor_sequence, state_sequence,
          active, updated_slot, updated_at
        )
        VALUES (
          ${networkTwo}, ${identityTwo}, ${postReference}, 1,
          ${reactionReference}, ${rootAuthority}, 3, 1, true, 3, ${now}
        )
      `;
      await sql`
        INSERT INTO governance_proposals (
          proposal_address, network_id, community_address, proposer_identity_id, authority,
          proposer_sequence, previous_community_sequence, manifest_hash, manifest_uri,
          governance_version, governance_strategy_hash, voting_model, eligible_member_count,
          opens_at_slot, closes_at_slot, quorum_bps, approval_bps, state_sequence, outcome,
          created_slot, created_at
        )
        VALUES (
          ${proposalAddress}, ${networkTwo}, ${communityAddress}, ${identityTwo}, ${rootAuthority},
          3, 2, 'uLegacyProposalManifestHash', 'local://network-two-proposal', 1,
          ${governanceStrategyHash}, 'one-active-member-one-vote', 1,
          5, 7, 5000, 5001, 1, 'pending', 4, ${now}
        )
      `;
      await sql`
        INSERT INTO governance_votes (
          vote_address, network_id, community_address, proposal_address, voter_identity_id,
          membership_address, authority, voter_sequence, membership_state_sequence,
          proposal_state_sequence, choice, yes_votes, no_votes, abstain_votes,
          cast_slot, cast_at
        )
        VALUES (
          ${voteAddress}, ${networkTwo}, ${communityAddress}, ${proposalAddress}, ${identityTwo},
          ${membershipAddress}, ${rootAuthority}, 1, 1, 2, 'yes', 1, 0, 0, 5, ${now}
        )
      `;
      await sql`
        INSERT INTO recovery_policies (
          recovery_policy_address, network_id, identity_id, root_authority, policy_sequence,
          identity_sequence, root_rotation_count, guardians, threshold, delay_slots,
          active, updated_slot, updated_at
        )
        VALUES (
          ${recoveryPolicyAddress}, ${networkTwo}, ${identityTwo}, ${rootAuthority}, 1,
          4, 0, ${sql.json([guardianOne, guardianTwo])}, 2, 2, true, 5, ${now}
        )
      `;
      await sql`
        INSERT INTO recovery_requests (
          recovery_request_address, network_id, identity_id, recovery_policy_address,
          request_nonce, policy_sequence, current_root_authority, identity_sequence,
          root_rotation_count, target_root_authority, requesting_guardian, guardians,
          threshold, guardian_count, approvals_mask, approved_guardians, approval_count,
          requested_slot, requested_at, execute_after_slot, state, updated_slot, updated_at
        )
        VALUES (
          ${recoveryRequestAddress}, ${networkTwo}, ${identityTwo}, ${recoveryPolicyAddress},
          '00112233445566778899aabbccddeeff', 1, ${rootAuthority}, 4,
          0, ${targetRootAuthority}, ${guardianOne},
          ${sql.json([guardianOne, guardianTwo])}, 2, 2, 1,
          ${sql.json([guardianOne])}, 1, 6, ${now}, 8, 'pending', 6, ${now}
        )
      `;

      for (const table of [
        'delegations',
        'blocks',
        'communities',
        'community_governance_history',
        'community_memberships',
        'reactions',
        'governance_proposals',
        'governance_votes',
        'recovery_policies',
        'recovery_requests',
      ]) {
        const rows = await sql.unsafe<{ count: number }[]>(
          `SELECT count(*)::integer AS count FROM "${table}"`,
        );
        expect(rows).toEqual([{ count: 2 }]);
      }
      await expect(sql`SELECT count(*)::integer AS count FROM identities`).resolves.toEqual([
        { count: 4 },
      ]);

      const legacyPostObjectId = 'legacy-post-object';
      const legacyHandleAddress = publicKey();
      await sql`
        INSERT INTO posts (
          object_id, network_id, author_identity_id, cid, payload_hash, signing_key_id,
          language, content, created_at, anchored_slot, transaction_signature, verified
        )
        VALUES (
          ${legacyPostObjectId}, ${networkOne}, ${identityOne}, 'baaaaaaaaaaaaaaaaaaaa',
          'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'legacy-signing-key',
          'en', ${sql.json({ body: 'legacy' })}, ${now}, 7, 'legacy-post-signature', true
        )
      `;
      await sql`
        INSERT INTO handle_claims (
          network_id, handle_claim_address, handle, handle_hash, identity_id, authority,
          identity_sequence, active, claimed_slot, claimed_at
        )
        VALUES (
          ${networkOne}, ${legacyHandleAddress}, 'legacy_handle',
          'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ${identityOne}, ${rootAuthority},
          5, true, 7, ${now}
        )
      `;

      await sql.unsafe(await readFile(join(migrationDirectory, migration0009 as string), 'utf8'));

      const networkThree = `wokenet:v1:${publicKey()}:${programId}`;
      const identityThreeAddress = publicKey();
      const subjectIdentityThreeAddress = publicKey();
      const unusedIdentityOneAddress = publicKey();
      const identityThree = `wokesocialid:v1:${networkThree}:${identityThreeAddress}`;
      const subjectIdentityThree = `wokesocialid:v1:${networkThree}:${subjectIdentityThreeAddress}`;
      const unusedIdentityOne = `wokesocialid:v1:${networkOne}:${unusedIdentityOneAddress}`;
      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        )
        VALUES
          (${identityThree}, ${networkThree}, ${identityThreeAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now}),
          (${subjectIdentityThree}, ${networkThree}, ${subjectIdentityThreeAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now}),
          (${unusedIdentityOne}, ${networkOne}, ${unusedIdentityOneAddress}, ${rootAuthority}, 0, 1, ${now}, 1, ${now})
      `;
      const mismatchedIdentityAddress = publicKey();
      await expect(
        sql`
          INSERT INTO identities (
            identity_id, network_id, identity_address, root_authority,
            root_rotation_count, created_slot, created_at, updated_slot, updated_at
          )
          VALUES (
            ${`wokesocialid:v1:${networkOne}:${mismatchedIdentityAddress}`},
            ${networkThree}, ${mismatchedIdentityAddress}, ${rootAuthority},
            0, 1, ${now}, 1, ${now}
          )
        `,
      ).rejects.toMatchObject({
        code: '23514',
        constraint_name: 'identities_network_address_binding',
      });
      await sql`
        INSERT INTO communities (
          community_address, network_id, creator_identity_id, authority, creator_sequence,
          manifest_cid, manifest_hash, governance_version, governance_strategy_hash,
          created_slot, created_at, updated_slot, updated_at
        )
        VALUES (
          ${communityAddress}, ${networkThree}, ${identityThree}, ${rootAuthority}, 2,
          'bafynetworkthreecommunity', 'uNetworkThreeCommunityManifest', 1,
          ${governanceStrategyHash}, 2, ${now}, 2, ${now}
        )
      `;
      await sql`
        INSERT INTO community_memberships (
          network_id, community_address, member_identity_id, membership_address,
          assigned_by_identity_id, authority, authority_sequence, state_sequence,
          roles, active, updated_slot, updated_at
        )
        VALUES (
          ${networkThree}, ${communityAddress}, ${identityThree}, ${membershipAddress},
          ${identityThree}, ${rootAuthority}, 3, 1, 1, true, 3, ${now}
        )
      `;
      await sql`
        INSERT INTO governance_proposals (
          proposal_address, network_id, community_address, proposer_identity_id, authority,
          proposer_sequence, previous_community_sequence, manifest_hash, manifest_uri,
          governance_version, governance_strategy_hash, voting_model, eligible_member_count,
          opens_at_slot, closes_at_slot, quorum_bps, approval_bps, state_sequence, outcome,
          created_slot, created_at
        )
        VALUES (
          ${proposalAddress}, ${networkThree}, ${communityAddress}, ${identityThree}, ${rootAuthority},
          3, 2, 'uNetworkThreeProposalManifest', 'local://network-three-proposal', 1,
          ${governanceStrategyHash}, 'one-active-member-one-vote', 1,
          5, 7, 5000, 5001, 1, 'pending', 4, ${now}
        )
      `;
      await sql`
        INSERT INTO recovery_policies (
          recovery_policy_address, network_id, identity_id, root_authority, policy_sequence,
          identity_sequence, root_rotation_count, guardians, threshold, delay_slots,
          active, updated_slot, updated_at
        )
        VALUES (
          ${recoveryPolicyAddress}, ${networkThree}, ${identityThree}, ${rootAuthority}, 1,
          4, 0, ${sql.json([guardianOne, guardianTwo])}, 2, 2, true, 5, ${now}
        )
      `;

      await expectForeignKey(
        sql`UPDATE posts SET network_id = ${networkThree} WHERE object_id = ${legacyPostObjectId}`,
        'posts_network_author_identity_fkey',
      );
      await expectForeignKey(
        sql`UPDATE handle_claims SET network_id = ${networkThree}
            WHERE network_id = ${networkOne} AND handle_claim_address = ${legacyHandleAddress}`,
        'handle_claims_network_identity_fkey',
      );
      await expectForeignKey(
        sql`UPDATE delegations SET network_id = ${networkThree}
            WHERE network_id = ${networkOne} AND delegation_address = ${delegationAddress}`,
        'delegations_network_identity_fkey',
      );
      await expectForeignKey(
        sql`UPDATE blocks SET network_id = ${networkThree}
            WHERE blocker_identity_id = ${identityOne}
              AND subject_identity_id = ${subjectIdentityOne}`,
        'blocks_network_blocker_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO communities (
            community_address, network_id, creator_identity_id, authority, creator_sequence,
            manifest_cid, manifest_hash, governance_version, governance_strategy_hash,
            created_slot, created_at, updated_slot, updated_at
          )
          VALUES (
            ${publicKey()}, ${networkThree}, ${unusedIdentityOne}, ${rootAuthority}, 1,
            'bafycrossnetworkcommunity', 'uCrossNetworkCommunityManifest', 1,
            ${governanceStrategyHash}, 2, ${now}, 2, ${now}
          )
        `,
        'communities_network_creator_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO community_memberships (
            network_id, community_address, member_identity_id, membership_address,
            assigned_by_identity_id, authority, authority_sequence, state_sequence,
            roles, active, updated_slot, updated_at
          )
          VALUES (
            ${networkThree}, ${communityAddress}, ${unusedIdentityOne}, ${publicKey()},
            ${identityThree}, ${rootAuthority}, 4, 1, 1, true, 4, ${now}
          )
        `,
        'community_memberships_network_member_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO community_memberships (
            network_id, community_address, member_identity_id, membership_address,
            assigned_by_identity_id, authority, authority_sequence, state_sequence,
            roles, active, updated_slot, updated_at
          )
          VALUES (
            ${networkThree}, ${communityAddress}, ${subjectIdentityThree}, ${publicKey()},
            ${unusedIdentityOne}, ${rootAuthority}, 4, 1, 1, true, 4, ${now}
          )
        `,
        'community_memberships_network_assigner_identity_fkey',
      );
      await expectForeignKey(
        sql`UPDATE reactions SET network_id = ${networkThree}
            WHERE network_id = ${networkOne} AND reaction_reference = ${reactionReference}`,
        'reactions_network_reactor_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO governance_proposals (
            proposal_address, network_id, community_address, proposer_identity_id, authority,
            proposer_sequence, previous_community_sequence, manifest_hash, manifest_uri,
            governance_version, governance_strategy_hash, voting_model, eligible_member_count,
            opens_at_slot, closes_at_slot, quorum_bps, approval_bps, state_sequence, outcome,
            created_slot, created_at
          )
          VALUES (
            ${publicKey()}, ${networkThree}, ${communityAddress}, ${unusedIdentityOne},
            ${rootAuthority}, 4, 3, 'uCrossNetworkProposalManifest',
            'local://cross-network-proposal', 1, ${governanceStrategyHash},
            'one-active-member-one-vote', 1, 5, 7, 5000, 5001, 1, 'pending', 4, ${now}
          )
        `,
        'governance_proposals_network_proposer_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO governance_votes (
            vote_address, network_id, community_address, proposal_address, voter_identity_id,
            membership_address, authority, voter_sequence, membership_state_sequence,
            proposal_state_sequence, choice, yes_votes, no_votes, abstain_votes,
            cast_slot, cast_at
          )
          VALUES (
            ${publicKey()}, ${networkThree}, ${communityAddress}, ${proposalAddress},
            ${unusedIdentityOne}, ${membershipAddress}, ${rootAuthority}, 1, 1, 2,
            'yes', 1, 0, 0, 5, ${now}
          )
        `,
        'governance_votes_network_voter_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO recovery_policies (
            recovery_policy_address, network_id, identity_id, root_authority, policy_sequence,
            identity_sequence, root_rotation_count, guardians, threshold, delay_slots,
            active, updated_slot, updated_at
          )
          VALUES (
            ${publicKey()}, ${networkThree}, ${unusedIdentityOne}, ${rootAuthority}, 1,
            1, 0, ${sql.json([guardianOne, guardianTwo])}, 2, 2, true, 5, ${now}
          )
        `,
        'recovery_policies_network_identity_fkey',
      );
      await expectForeignKey(
        sql`
          INSERT INTO recovery_requests (
            recovery_request_address, network_id, identity_id, recovery_policy_address,
            request_nonce, policy_sequence, current_root_authority, identity_sequence,
            root_rotation_count, target_root_authority, requesting_guardian, guardians,
            threshold, guardian_count, approvals_mask, approved_guardians, approval_count,
            requested_slot, requested_at, execute_after_slot, state, updated_slot, updated_at
          )
          VALUES (
            ${publicKey()}, ${networkThree}, ${unusedIdentityOne}, ${recoveryPolicyAddress},
            '11112222333344445555666677778888', 1, ${rootAuthority}, 1, 0,
            ${targetRootAuthority}, ${guardianOne}, ${sql.json([guardianOne, guardianTwo])},
            2, 2, 1, ${sql.json([guardianOne])}, 1, 6, ${now}, 8, 'pending', 6, ${now}
          )
        `,
        'recovery_requests_network_identity_fkey',
      );
    } finally {
      await sql.unsafe('SET search_path TO public');
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}

async function expectForeignKey(
  query: PromiseLike<unknown>,
  constraintName: string,
): Promise<void> {
  await expect(query).rejects.toMatchObject({
    code: '23503',
    constraint_name: constraintName,
  });
}
