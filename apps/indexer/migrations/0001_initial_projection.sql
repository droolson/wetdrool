CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS protocol_events (
  network_id text NOT NULL,
  transaction_signature text NOT NULL,
  log_index integer NOT NULL CHECK (log_index >= 0),
  slot numeric(20, 0) NOT NULL CHECK (slot >= 0),
  block_time timestamptz NOT NULL,
  event_type text NOT NULL,
  event_body jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network_id, transaction_signature, log_index)
);

CREATE INDEX IF NOT EXISTS protocol_events_replay_order
  ON protocol_events (network_id, slot, transaction_signature, log_index);

CREATE TABLE IF NOT EXISTS identities (
  identity_id text PRIMARY KEY,
  network_id text NOT NULL,
  identity_address text NOT NULL,
  root_authority text NOT NULL,
  created_slot numeric(20, 0) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (network_id, identity_address)
);

CREATE TABLE IF NOT EXISTS profiles (
  identity_id text PRIMARY KEY REFERENCES identities(identity_id),
  object_id text NOT NULL,
  cid text NOT NULL,
  payload_hash text NOT NULL,
  display_name text NOT NULL,
  bio text NOT NULL,
  pronouns jsonb NOT NULL,
  updated_slot numeric(20, 0) NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  object_id text PRIMARY KEY,
  network_id text NOT NULL,
  author_identity_id text NOT NULL REFERENCES identities(identity_id),
  cid text NOT NULL,
  payload_hash text NOT NULL,
  signing_key_id text NOT NULL,
  body text,
  language text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  anchored_slot numeric(20, 0) NOT NULL,
  transaction_signature text NOT NULL,
  verified boolean NOT NULL CHECK (verified),
  tombstoned_at timestamptz
);

CREATE INDEX IF NOT EXISTS posts_chronological
  ON posts (created_at DESC, object_id DESC)
  WHERE tombstoned_at IS NULL;

CREATE TABLE IF NOT EXISTS follows (
  follower_identity_id text NOT NULL REFERENCES identities(identity_id),
  followed_identity_id text NOT NULL REFERENCES identities(identity_id),
  active boolean NOT NULL,
  updated_slot numeric(20, 0) NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (follower_identity_id, followed_identity_id),
  CHECK (follower_identity_id <> followed_identity_id)
);

CREATE INDEX IF NOT EXISTS active_follows_by_follower
  ON follows (follower_identity_id, followed_identity_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  network_id text PRIMARY KEY,
  finalized_slot numeric(20, 0) NOT NULL CHECK (finalized_slot >= 0),
  transaction_signature text NOT NULL,
  log_index integer NOT NULL CHECK (log_index >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indexer_dead_letters (
  id bigserial PRIMARY KEY,
  network_id text NOT NULL,
  transaction_signature text NOT NULL,
  log_index integer NOT NULL,
  event_body jsonb NOT NULL,
  failure_code text NOT NULL,
  failure_detail text NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, transaction_signature, log_index)
);
