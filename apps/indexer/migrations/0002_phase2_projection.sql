ALTER TABLE protocol_events
  ADD COLUMN IF NOT EXISTS transaction_index integer CHECK (transaction_index >= 0);

DROP INDEX IF EXISTS protocol_events_replay_order;
CREATE INDEX protocol_events_replay_order
  ON protocol_events (
    network_id,
    slot,
    transaction_index NULLS LAST,
    transaction_signature,
    log_index
  );

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS root_rotation_count numeric(20, 0) NOT NULL DEFAULT 0
    CHECK (root_rotation_count >= 0),
  ADD COLUMN IF NOT EXISTS updated_slot numeric(20, 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE identities
SET updated_slot = created_slot, updated_at = created_at
WHERE updated_slot IS NULL OR updated_at IS NULL;

ALTER TABLE identities
  ALTER COLUMN updated_slot SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE follows
  ADD COLUMN IF NOT EXISTS state_sequence numeric(20, 0) NOT NULL DEFAULT 1
    CHECK (state_sequence > 0);

CREATE TABLE IF NOT EXISTS protocol_configs (
  network_id text PRIMARY KEY,
  config_address text NOT NULL,
  initialized_slot numeric(20, 0) NOT NULL CHECK (initialized_slot >= 0),
  initialized_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS root_authority_history (
  identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  rotation_count numeric(20, 0) NOT NULL CHECK (rotation_count >= 0),
  authority text NOT NULL,
  from_slot numeric(20, 0) NOT NULL CHECK (from_slot >= 0),
  from_transaction_index integer CHECK (from_transaction_index >= 0),
  from_transaction_signature text NOT NULL,
  from_log_index integer NOT NULL CHECK (from_log_index >= 0),
  PRIMARY KEY (identity_id, rotation_count),
  UNIQUE (identity_id, authority, rotation_count)
);

INSERT INTO root_authority_history (
  identity_id, rotation_count, authority, from_slot,
  from_transaction_signature, from_log_index
)
SELECT
  i.identity_id, 0, i.root_authority, i.created_slot,
  e.transaction_signature, e.log_index
FROM identities i
JOIN protocol_events e
  ON e.network_id = i.network_id
  AND e.event_type = 'identity-created'
  AND e.event_body ->> 'identityId' = i.identity_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS delegations (
  delegation_address text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  delegate_authority text NOT NULL,
  delegation_sequence numeric(20, 0) NOT NULL CHECK (delegation_sequence >= 0),
  identity_sequence numeric(20, 0) NOT NULL CHECK (identity_sequence > 0),
  scopes integer NOT NULL CHECK (scopes > 0 AND scopes <= 15),
  issued_at_root_rotation_count numeric(20, 0) NOT NULL
    CHECK (issued_at_root_rotation_count >= 0),
  issued_at_slot numeric(20, 0) NOT NULL CHECK (issued_at_slot >= 0),
  expires_at_slot numeric(20, 0) NOT NULL CHECK (expires_at_slot > issued_at_slot),
  state_sequence numeric(20, 0) NOT NULL DEFAULT 1 CHECK (state_sequence > 0),
  revoked_at_slot numeric(20, 0) CHECK (revoked_at_slot >= issued_at_slot),
  created_transaction_index integer CHECK (created_transaction_index >= 0),
  created_transaction_signature text NOT NULL,
  created_log_index integer NOT NULL CHECK (created_log_index >= 0),
  revoked_transaction_index integer CHECK (revoked_transaction_index >= 0),
  revoked_transaction_signature text,
  revoked_log_index integer CHECK (revoked_log_index >= 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (identity_id, delegation_sequence),
  CHECK (
    (revoked_at_slot IS NULL AND revoked_transaction_signature IS NULL AND revoked_log_index IS NULL)
    OR
    (revoked_at_slot IS NOT NULL AND revoked_transaction_signature IS NOT NULL AND revoked_log_index IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS delegations_by_authority
  ON delegations (identity_id, delegate_authority);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  subject_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  block_edge_address text NOT NULL,
  authority text NOT NULL,
  blocker_sequence numeric(20, 0) NOT NULL CHECK (blocker_sequence > 0),
  state_sequence numeric(20, 0) NOT NULL CHECK (state_sequence > 0),
  active boolean NOT NULL,
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_identity_id, subject_identity_id),
  UNIQUE (block_edge_address),
  CHECK (blocker_identity_id <> subject_identity_id)
);

CREATE INDEX IF NOT EXISTS active_blocks_by_blocker
  ON blocks (blocker_identity_id, subject_identity_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS communities (
  community_address text PRIMARY KEY,
  network_id text NOT NULL,
  creator_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  authority text NOT NULL,
  creator_sequence numeric(20, 0) NOT NULL CHECK (creator_sequence > 0),
  manifest_cid text NOT NULL,
  manifest_hash text NOT NULL,
  manifest_verified boolean NOT NULL DEFAULT false CHECK (NOT manifest_verified),
  governance_version integer NOT NULL CHECK (governance_version > 0 AND governance_version <= 65535),
  governance_strategy_hash text NOT NULL,
  created_slot numeric(20, 0) NOT NULL CHECK (created_slot >= 0),
  created_at timestamptz NOT NULL,
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= created_slot),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS community_governance_history (
  community_address text NOT NULL REFERENCES communities(community_address) ON DELETE CASCADE,
  governance_version integer NOT NULL CHECK (governance_version > 0 AND governance_version <= 65535),
  strategy_hash text NOT NULL,
  authority text NOT NULL,
  creator_sequence numeric(20, 0) NOT NULL CHECK (creator_sequence > 0),
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (community_address, governance_version)
);

CREATE TABLE IF NOT EXISTS community_memberships (
  community_address text NOT NULL REFERENCES communities(community_address) ON DELETE CASCADE,
  member_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  membership_address text NOT NULL,
  assigned_by_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  authority text NOT NULL,
  authority_sequence numeric(20, 0) NOT NULL CHECK (authority_sequence > 0),
  state_sequence numeric(20, 0) NOT NULL CHECK (state_sequence > 0),
  roles integer NOT NULL CHECK (roles >= 0 AND roles <= 7),
  active boolean NOT NULL,
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (community_address, member_identity_id),
  UNIQUE (membership_address),
  CHECK ((active AND roles > 0 AND (roles & 1) = 1) OR (NOT active AND roles = 0))
);

CREATE INDEX IF NOT EXISTS active_community_memberships
  ON community_memberships (community_address, member_identity_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS reactions (
  network_id text NOT NULL,
  reactor_identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  target_post_reference text NOT NULL,
  reaction_kind integer NOT NULL CHECK (reaction_kind >= 0 AND reaction_kind <= 255),
  reaction_reference text NOT NULL,
  authority text NOT NULL,
  reactor_sequence numeric(20, 0) NOT NULL CHECK (reactor_sequence > 0),
  state_sequence numeric(20, 0) NOT NULL CHECK (state_sequence > 0),
  active boolean NOT NULL,
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (
    network_id,
    reactor_identity_id,
    target_post_reference,
    reaction_kind
  ),
  UNIQUE (reaction_reference)
);

CREATE INDEX IF NOT EXISTS reactions_by_target
  ON reactions (network_id, target_post_reference, reaction_kind, reactor_identity_id)
  WHERE active;
