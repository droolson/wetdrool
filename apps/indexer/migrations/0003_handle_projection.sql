CREATE TABLE IF NOT EXISTS handle_claims (
  network_id text NOT NULL,
  handle_claim_address text NOT NULL,
  handle text NOT NULL CHECK (
    octet_length(handle) BETWEEN 3 AND 30
    AND handle ~ '^[a-z0-9][a-z0-9_]*[a-z0-9]$'
    AND handle !~ '__'
  ),
  handle_hash text NOT NULL,
  identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  authority text NOT NULL,
  identity_sequence numeric(20, 0) NOT NULL CHECK (
    identity_sequence > 0
    AND identity_sequence <= 18446744073709551615
  ),
  active boolean NOT NULL,
  claimed_slot numeric(20, 0) NOT NULL CHECK (claimed_slot >= 0),
  claimed_at timestamptz NOT NULL,
  released_slot numeric(20, 0),
  released_at timestamptz,
  PRIMARY KEY (network_id, handle_claim_address),
  UNIQUE (network_id, handle),
  CHECK (
    (active AND released_slot IS NULL AND released_at IS NULL)
    OR
    (
      NOT active
      AND released_slot IS NOT NULL
      AND released_slot >= claimed_slot
      AND released_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS active_handles_by_identity
  ON handle_claims (identity_id, handle)
  WHERE active;
