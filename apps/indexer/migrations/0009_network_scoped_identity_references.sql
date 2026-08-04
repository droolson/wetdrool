ALTER TABLE identities
  ADD CONSTRAINT identities_network_identity_key
  UNIQUE (network_id, identity_id),
  ADD CONSTRAINT identities_network_address_binding
  CHECK (identity_id = 'wetdroolid:v1:' || network_id || ':' || identity_address);

ALTER TABLE posts
  DROP CONSTRAINT posts_author_identity_id_fkey;
ALTER TABLE handle_claims
  DROP CONSTRAINT handle_claims_identity_id_fkey;
ALTER TABLE delegations
  DROP CONSTRAINT delegations_identity_id_fkey;
ALTER TABLE blocks
  DROP CONSTRAINT blocks_blocker_identity_id_fkey,
  DROP CONSTRAINT blocks_subject_identity_id_fkey;
ALTER TABLE communities
  DROP CONSTRAINT communities_creator_identity_id_fkey;
ALTER TABLE community_memberships
  DROP CONSTRAINT community_memberships_member_identity_id_fkey,
  DROP CONSTRAINT community_memberships_assigned_by_identity_id_fkey;
ALTER TABLE reactions
  DROP CONSTRAINT reactions_reactor_identity_id_fkey;
ALTER TABLE governance_proposals
  DROP CONSTRAINT governance_proposals_proposer_identity_id_fkey;
ALTER TABLE governance_votes
  DROP CONSTRAINT governance_votes_voter_identity_id_fkey;
ALTER TABLE recovery_policies
  DROP CONSTRAINT recovery_policies_identity_id_fkey;
ALTER TABLE recovery_requests
  DROP CONSTRAINT recovery_requests_identity_id_fkey;

ALTER TABLE posts
  ADD CONSTRAINT posts_network_author_identity_fkey
  FOREIGN KEY (network_id, author_identity_id)
  REFERENCES identities(network_id, identity_id);

ALTER TABLE handle_claims
  ADD CONSTRAINT handle_claims_network_identity_fkey
  FOREIGN KEY (network_id, identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE delegations
  ADD CONSTRAINT delegations_network_identity_fkey
  FOREIGN KEY (network_id, identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE blocks
  ADD CONSTRAINT blocks_network_blocker_identity_fkey
  FOREIGN KEY (network_id, blocker_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE,
  ADD CONSTRAINT blocks_network_subject_identity_fkey
  FOREIGN KEY (network_id, subject_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE communities
  ADD CONSTRAINT communities_network_creator_identity_fkey
  FOREIGN KEY (network_id, creator_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE community_memberships
  ADD CONSTRAINT community_memberships_network_member_identity_fkey
  FOREIGN KEY (network_id, member_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE,
  ADD CONSTRAINT community_memberships_network_assigner_identity_fkey
  FOREIGN KEY (network_id, assigned_by_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE reactions
  ADD CONSTRAINT reactions_network_reactor_identity_fkey
  FOREIGN KEY (network_id, reactor_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_network_proposer_identity_fkey
  FOREIGN KEY (network_id, proposer_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE governance_votes
  ADD CONSTRAINT governance_votes_network_voter_identity_fkey
  FOREIGN KEY (network_id, voter_identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE recovery_policies
  ADD CONSTRAINT recovery_policies_network_identity_fkey
  FOREIGN KEY (network_id, identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;

ALTER TABLE recovery_requests
  ADD CONSTRAINT recovery_requests_network_identity_fkey
  FOREIGN KEY (network_id, identity_id)
  REFERENCES identities(network_id, identity_id)
  ON DELETE CASCADE;
