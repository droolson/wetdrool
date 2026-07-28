CREATE TABLE IF NOT EXISTS recovery_policies (
  recovery_policy_address text PRIMARY KEY,
  network_id text NOT NULL,
  identity_id text NOT NULL UNIQUE REFERENCES identities(identity_id) ON DELETE CASCADE,
  root_authority text NOT NULL,
  policy_sequence numeric(20, 0) NOT NULL CHECK (
    policy_sequence > 0 AND policy_sequence <= 18446744073709551615
  ),
  identity_sequence numeric(20, 0) NOT NULL CHECK (
    identity_sequence > 0 AND identity_sequence <= 18446744073709551615
  ),
  root_rotation_count numeric(20, 0) NOT NULL CHECK (
    root_rotation_count >= 0 AND root_rotation_count <= 18446744073709551615
  ),
  guardians jsonb NOT NULL CHECK (
    jsonb_typeof(guardians) = 'array'
    AND jsonb_array_length(guardians) BETWEEN 2 AND 5
  ),
  threshold integer NOT NULL CHECK (threshold BETWEEN 2 AND 5),
  delay_slots numeric(20, 0) NOT NULL CHECK (delay_slots BETWEEN 2 AND 1000000),
  active boolean NOT NULL,
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= 0),
  updated_at timestamptz NOT NULL,
  CHECK (threshold <= jsonb_array_length(guardians))
);

CREATE INDEX IF NOT EXISTS recovery_policies_by_network
  ON recovery_policies (network_id, identity_id);

CREATE TABLE IF NOT EXISTS recovery_requests (
  recovery_request_address text PRIMARY KEY,
  network_id text NOT NULL,
  identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  recovery_policy_address text NOT NULL REFERENCES recovery_policies(recovery_policy_address)
    ON DELETE CASCADE,
  request_nonce text NOT NULL CHECK (request_nonce ~ '^[0-9a-f]{32}$'),
  policy_sequence numeric(20, 0) NOT NULL CHECK (
    policy_sequence > 0 AND policy_sequence <= 18446744073709551615
  ),
  current_root_authority text NOT NULL,
  identity_sequence numeric(20, 0) NOT NULL CHECK (
    identity_sequence > 0 AND identity_sequence <= 18446744073709551615
  ),
  root_rotation_count numeric(20, 0) NOT NULL CHECK (
    root_rotation_count >= 0 AND root_rotation_count <= 18446744073709551615
  ),
  target_root_authority text NOT NULL,
  requesting_guardian text NOT NULL,
  guardians jsonb NOT NULL CHECK (
    jsonb_typeof(guardians) = 'array'
    AND jsonb_array_length(guardians) BETWEEN 2 AND 5
  ),
  threshold integer NOT NULL CHECK (threshold BETWEEN 2 AND 5),
  guardian_count integer NOT NULL CHECK (guardian_count BETWEEN 2 AND 5),
  approvals_mask integer NOT NULL CHECK (approvals_mask BETWEEN 1 AND 31),
  approved_guardians jsonb NOT NULL CHECK (
    jsonb_typeof(approved_guardians) = 'array'
    AND jsonb_array_length(approved_guardians) BETWEEN 1 AND 5
  ),
  approval_count integer NOT NULL CHECK (approval_count BETWEEN 1 AND 5),
  requested_slot numeric(20, 0) NOT NULL CHECK (requested_slot >= 0),
  requested_at timestamptz NOT NULL,
  execute_after_slot numeric(20, 0) NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'cancelled', 'executed')),
  updated_slot numeric(20, 0) NOT NULL CHECK (updated_slot >= requested_slot),
  updated_at timestamptz NOT NULL,
  terminal_identity_sequence numeric(20, 0),
  terminal_root_rotation_count numeric(20, 0),
  terminal_slot numeric(20, 0),
  terminal_at timestamptz,
  cancelled_by_root_authority text,
  executor text,
  UNIQUE (identity_id, request_nonce),
  CHECK (current_root_authority <> target_root_authority),
  CHECK (
    guardian_count = jsonb_array_length(guardians)
    AND threshold <= guardian_count
    AND approval_count = jsonb_array_length(approved_guardians)
    AND approval_count <= guardian_count
  ),
  CHECK (
    execute_after_slot > requested_slot
    AND execute_after_slot - requested_slot BETWEEN 2 AND 1000000
  ),
  CHECK (
    (
      state = 'pending'
      AND terminal_identity_sequence IS NULL
      AND terminal_root_rotation_count IS NULL
      AND terminal_slot IS NULL
      AND terminal_at IS NULL
      AND cancelled_by_root_authority IS NULL
      AND executor IS NULL
    )
    OR
    (
      state = 'cancelled'
      AND terminal_identity_sequence IS NOT NULL
      AND terminal_root_rotation_count IS NOT NULL
      AND terminal_slot IS NOT NULL
      AND terminal_slot >= requested_slot
      AND terminal_at IS NOT NULL
      AND cancelled_by_root_authority IS NOT NULL
      AND executor IS NULL
    )
    OR
    (
      state = 'executed'
      AND terminal_identity_sequence IS NOT NULL
      AND terminal_root_rotation_count IS NOT NULL
      AND terminal_slot IS NOT NULL
      AND terminal_slot >= execute_after_slot
      AND terminal_at IS NOT NULL
      AND cancelled_by_root_authority IS NULL
      AND executor IS NOT NULL
      AND approval_count >= threshold
    )
  )
);

CREATE INDEX IF NOT EXISTS recovery_requests_by_identity
  ON recovery_requests (identity_id, requested_slot, recovery_request_address);
