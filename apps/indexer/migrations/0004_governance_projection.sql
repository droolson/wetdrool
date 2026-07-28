CREATE TABLE IF NOT EXISTS governance_proposals (
  proposal_address text PRIMARY KEY,
  network_id text NOT NULL,
  community_address text NOT NULL REFERENCES communities(community_address) ON DELETE CASCADE,
  proposer_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  authority text NOT NULL,
  proposer_sequence numeric(20, 0) NOT NULL CHECK (
    proposer_sequence > 0 AND proposer_sequence <= 18446744073709551615
  ),
  previous_community_sequence numeric(20, 0) NOT NULL CHECK (
    previous_community_sequence >= 0
    AND previous_community_sequence <= 18446744073709551615
    AND proposer_sequence > previous_community_sequence
  ),
  manifest_hash text NOT NULL,
  manifest_uri text NOT NULL CHECK (
    octet_length(manifest_uri) BETWEEN 1 AND 200
    AND manifest_uri ~ '^(ipfs|ar|https|local)://[^[:space:]]+$'
    AND manifest_uri !~ '[<>"''\\]'
  ),
  manifest_verified boolean NOT NULL DEFAULT false CHECK (NOT manifest_verified),
  governance_version integer NOT NULL CHECK (
    governance_version > 0 AND governance_version <= 65535
  ),
  governance_strategy_hash text NOT NULL CHECK (
    governance_strategy_hash = 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA'
  ),
  voting_model text NOT NULL CHECK (voting_model = 'one-active-member-one-vote'),
  eligible_member_count numeric(20, 0) NOT NULL CHECK (
    eligible_member_count > 0 AND eligible_member_count <= 18446744073709551615
  ),
  opens_at_slot numeric(20, 0) NOT NULL CHECK (opens_at_slot >= 0),
  closes_at_slot numeric(20, 0) NOT NULL,
  quorum_bps integer NOT NULL CHECK (quorum_bps = 5000),
  approval_bps integer NOT NULL CHECK (approval_bps = 5001),
  yes_votes numeric(20, 0) NOT NULL DEFAULT 0 CHECK (yes_votes >= 0),
  no_votes numeric(20, 0) NOT NULL DEFAULT 0 CHECK (no_votes >= 0),
  abstain_votes numeric(20, 0) NOT NULL DEFAULT 0 CHECK (abstain_votes >= 0),
  state_sequence numeric(20, 0) NOT NULL CHECK (
    state_sequence > 0 AND state_sequence <= 18446744073709551615
  ),
  outcome text NOT NULL CHECK (outcome IN ('pending', 'accepted', 'rejected')),
  created_slot numeric(20, 0) NOT NULL CHECK (created_slot >= 0),
  created_at timestamptz NOT NULL,
  finalizer text,
  participating_votes numeric(20, 0),
  decisive_votes numeric(20, 0),
  quorum_met boolean,
  approval_met boolean,
  finalized_slot numeric(20, 0),
  finalized_at timestamptz,
  UNIQUE (community_address, manifest_hash),
  CHECK (
    opens_at_slot >= created_slot
    AND opens_at_slot - created_slot <= 100000
    AND closes_at_slot - opens_at_slot BETWEEN 2 AND 1000000
  ),
  CHECK (yes_votes + no_votes + abstain_votes <= eligible_member_count),
  CHECK (
    (
      outcome = 'pending'
      AND finalizer IS NULL
      AND participating_votes IS NULL
      AND decisive_votes IS NULL
      AND quorum_met IS NULL
      AND approval_met IS NULL
      AND finalized_slot IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      outcome IN ('accepted', 'rejected')
      AND finalizer IS NOT NULL
      AND participating_votes = yes_votes + no_votes + abstain_votes
      AND decisive_votes = yes_votes + no_votes
      AND quorum_met = (
        participating_votes * 10000 >= eligible_member_count * quorum_bps
      )
      AND approval_met = (
        decisive_votes > 0 AND yes_votes * 10000 >= decisive_votes * approval_bps
      )
      AND outcome = CASE
        WHEN quorum_met AND approval_met THEN 'accepted'
        ELSE 'rejected'
      END
      AND finalized_slot >= closes_at_slot
      AND finalized_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS governance_proposals_by_community
  ON governance_proposals (community_address, created_slot, proposal_address);

CREATE TABLE IF NOT EXISTS governance_votes (
  vote_address text PRIMARY KEY,
  network_id text NOT NULL,
  community_address text NOT NULL REFERENCES communities(community_address) ON DELETE CASCADE,
  proposal_address text NOT NULL REFERENCES governance_proposals(proposal_address) ON DELETE CASCADE,
  voter_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  membership_address text NOT NULL REFERENCES community_memberships(membership_address),
  authority text NOT NULL,
  voter_sequence numeric(20, 0) NOT NULL CHECK (
    voter_sequence > 0 AND voter_sequence <= 18446744073709551615
  ),
  membership_state_sequence numeric(20, 0) NOT NULL CHECK (
    membership_state_sequence > 0
    AND membership_state_sequence <= 18446744073709551615
  ),
  proposal_state_sequence numeric(20, 0) NOT NULL CHECK (
    proposal_state_sequence > 1
    AND proposal_state_sequence <= 18446744073709551615
  ),
  choice text NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
  yes_votes numeric(20, 0) NOT NULL CHECK (yes_votes >= 0),
  no_votes numeric(20, 0) NOT NULL CHECK (no_votes >= 0),
  abstain_votes numeric(20, 0) NOT NULL CHECK (abstain_votes >= 0),
  cast_slot numeric(20, 0) NOT NULL CHECK (cast_slot >= 0),
  cast_at timestamptz NOT NULL,
  UNIQUE (proposal_address, voter_identity_id),
  UNIQUE (proposal_address, proposal_state_sequence),
  CHECK (yes_votes + no_votes + abstain_votes > 0)
);

CREATE INDEX IF NOT EXISTS governance_votes_by_proposal
  ON governance_votes (proposal_address, proposal_state_sequence, vote_address);

CREATE INDEX IF NOT EXISTS governance_votes_by_voter_sequence
  ON governance_votes (voter_identity_id, voter_sequence DESC);
