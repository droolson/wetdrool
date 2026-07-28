ALTER TABLE delegations ADD COLUMN IF NOT EXISTS network_id text;
UPDATE delegations d
SET network_id = i.network_id
FROM identities i
WHERE d.identity_id = i.identity_id
  AND d.network_id IS NULL;
ALTER TABLE delegations ALTER COLUMN network_id SET NOT NULL;

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS network_id text;
UPDATE blocks b
SET network_id = i.network_id
FROM identities i
WHERE b.blocker_identity_id = i.identity_id
  AND b.network_id IS NULL;
ALTER TABLE blocks ALTER COLUMN network_id SET NOT NULL;

ALTER TABLE community_governance_history ADD COLUMN IF NOT EXISTS network_id text;
UPDATE community_governance_history h
SET network_id = c.network_id
FROM communities c
WHERE h.community_address = c.community_address
  AND h.network_id IS NULL;
ALTER TABLE community_governance_history ALTER COLUMN network_id SET NOT NULL;

ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS network_id text;
UPDATE community_memberships m
SET network_id = c.network_id
FROM communities c
WHERE m.community_address = c.community_address
  AND m.network_id IS NULL;
ALTER TABLE community_memberships ALTER COLUMN network_id SET NOT NULL;

ALTER TABLE community_governance_history
  DROP CONSTRAINT IF EXISTS community_governance_history_community_address_fkey;
ALTER TABLE community_memberships
  DROP CONSTRAINT IF EXISTS community_memberships_community_address_fkey;
ALTER TABLE governance_proposals
  DROP CONSTRAINT IF EXISTS governance_proposals_community_address_fkey;
ALTER TABLE governance_votes
  DROP CONSTRAINT IF EXISTS governance_votes_community_address_fkey,
  DROP CONSTRAINT IF EXISTS governance_votes_proposal_address_fkey,
  DROP CONSTRAINT IF EXISTS governance_votes_membership_address_fkey;
ALTER TABLE recovery_requests
  DROP CONSTRAINT IF EXISTS recovery_requests_recovery_policy_address_fkey;

ALTER TABLE delegations DROP CONSTRAINT IF EXISTS delegations_pkey;
ALTER TABLE delegations
  ADD CONSTRAINT delegations_pkey PRIMARY KEY (network_id, delegation_address);

ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_block_edge_address_key;
ALTER TABLE blocks
  ADD CONSTRAINT blocks_network_block_edge_address_key
  UNIQUE (network_id, block_edge_address);

ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_pkey;
ALTER TABLE communities
  ADD CONSTRAINT communities_pkey PRIMARY KEY (network_id, community_address);

ALTER TABLE community_governance_history
  DROP CONSTRAINT IF EXISTS community_governance_history_pkey;
ALTER TABLE community_governance_history
  ADD CONSTRAINT community_governance_history_pkey
    PRIMARY KEY (network_id, community_address, governance_version),
  ADD CONSTRAINT community_governance_history_network_community_fkey
    FOREIGN KEY (network_id, community_address)
    REFERENCES communities(network_id, community_address)
    ON DELETE CASCADE;

ALTER TABLE community_memberships
  DROP CONSTRAINT IF EXISTS community_memberships_pkey,
  DROP CONSTRAINT IF EXISTS community_memberships_membership_address_key;
ALTER TABLE community_memberships
  ADD CONSTRAINT community_memberships_pkey
    PRIMARY KEY (network_id, community_address, member_identity_id),
  ADD CONSTRAINT community_memberships_network_membership_address_key
    UNIQUE (network_id, membership_address),
  ADD CONSTRAINT community_memberships_network_community_fkey
    FOREIGN KEY (network_id, community_address)
    REFERENCES communities(network_id, community_address)
    ON DELETE CASCADE;

ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_reaction_reference_key;
ALTER TABLE reactions
  ADD CONSTRAINT reactions_network_reaction_reference_key
  UNIQUE (network_id, reaction_reference);

ALTER TABLE governance_proposals
  DROP CONSTRAINT IF EXISTS governance_proposals_pkey,
  DROP CONSTRAINT IF EXISTS governance_proposals_community_address_manifest_hash_key;
ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_pkey PRIMARY KEY (network_id, proposal_address),
  ADD CONSTRAINT governance_proposals_network_community_manifest_key
    UNIQUE (network_id, community_address, manifest_hash),
  ADD CONSTRAINT governance_proposals_network_community_fkey
    FOREIGN KEY (network_id, community_address)
    REFERENCES communities(network_id, community_address)
    ON DELETE CASCADE;

ALTER TABLE governance_votes
  DROP CONSTRAINT IF EXISTS governance_votes_pkey,
  DROP CONSTRAINT IF EXISTS governance_votes_proposal_address_voter_identity_id_key,
  DROP CONSTRAINT IF EXISTS governance_votes_proposal_address_proposal_state_sequence_key;
ALTER TABLE governance_votes
  ADD CONSTRAINT governance_votes_pkey PRIMARY KEY (network_id, vote_address),
  ADD CONSTRAINT governance_votes_network_proposal_voter_key
    UNIQUE (network_id, proposal_address, voter_identity_id),
  ADD CONSTRAINT governance_votes_network_proposal_sequence_key
    UNIQUE (network_id, proposal_address, proposal_state_sequence),
  ADD CONSTRAINT governance_votes_network_community_fkey
    FOREIGN KEY (network_id, community_address)
    REFERENCES communities(network_id, community_address)
    ON DELETE CASCADE,
  ADD CONSTRAINT governance_votes_network_proposal_fkey
    FOREIGN KEY (network_id, proposal_address)
    REFERENCES governance_proposals(network_id, proposal_address)
    ON DELETE CASCADE,
  ADD CONSTRAINT governance_votes_network_membership_fkey
    FOREIGN KEY (network_id, membership_address)
    REFERENCES community_memberships(network_id, membership_address);

ALTER TABLE recovery_policies DROP CONSTRAINT IF EXISTS recovery_policies_pkey;
ALTER TABLE recovery_policies
  ADD CONSTRAINT recovery_policies_pkey PRIMARY KEY (network_id, recovery_policy_address);

ALTER TABLE recovery_requests DROP CONSTRAINT IF EXISTS recovery_requests_pkey;
ALTER TABLE recovery_requests
  ADD CONSTRAINT recovery_requests_pkey PRIMARY KEY (network_id, recovery_request_address),
  ADD CONSTRAINT recovery_requests_network_policy_fkey
    FOREIGN KEY (network_id, recovery_policy_address)
    REFERENCES recovery_policies(network_id, recovery_policy_address)
    ON DELETE CASCADE;

DROP INDEX IF EXISTS active_community_memberships;
CREATE INDEX active_community_memberships
  ON community_memberships (network_id, community_address, member_identity_id)
  WHERE active;

DROP INDEX IF EXISTS governance_proposals_by_community;
CREATE INDEX governance_proposals_by_community
  ON governance_proposals (network_id, community_address, created_slot, proposal_address);

DROP INDEX IF EXISTS governance_votes_by_proposal;
CREATE INDEX governance_votes_by_proposal
  ON governance_votes (network_id, proposal_address, proposal_state_sequence, vote_address);
