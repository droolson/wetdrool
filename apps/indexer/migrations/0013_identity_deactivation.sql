ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS identity_sequence numeric(20, 0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sequence_slot numeric(20, 0),
  ADD COLUMN IF NOT EXISTS sequence_transaction_index integer,
  ADD COLUMN IF NOT EXISTS sequence_transaction_signature text,
  ADD COLUMN IF NOT EXISTS sequence_log_index integer,
  ADD COLUMN IF NOT EXISTS deactivated_slot numeric(20, 0),
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_transaction_index integer,
  ADD COLUMN IF NOT EXISTS deactivated_transaction_signature text,
  ADD COLUMN IF NOT EXISTS deactivated_log_index integer;

-- Establish a deterministic position for sequence zero before deriving later
-- identity mutations. The fallback is only for legacy rows whose immutable
-- creation event was not retained; its created slot still makes later events
-- order correctly and it cannot authorize a deactivated identity.
WITH creation_positions AS (
  SELECT
    event.network_id,
    event.event_body ->> 'identityId' AS identity_id,
    event.transaction_index,
    event.transaction_signature,
    event.log_index,
    row_number() OVER (
      PARTITION BY event.network_id, event.event_body ->> 'identityId'
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
    ) AS rank
  FROM protocol_events AS event
  WHERE event.event_type = 'identity-created'
)
UPDATE identities AS identity
SET
  sequence_slot = identity.created_slot,
  sequence_transaction_index = creation.transaction_index,
  sequence_transaction_signature = creation.transaction_signature,
  sequence_log_index = creation.log_index
FROM creation_positions AS creation
WHERE creation.rank = 1
  AND creation.network_id = identity.network_id
  AND creation.identity_id = identity.identity_id
  AND identity.sequence_slot IS NULL;

UPDATE identities
SET
  sequence_slot = created_slot,
  sequence_transaction_signature = 'legacy-identity-creation',
  sequence_log_index = 0
WHERE sequence_slot IS NULL
   OR sequence_transaction_signature IS NULL
   OR sequence_log_index IS NULL;

-- Backfill the best durable identity sequence from immutable raw events. Every
-- listed event advances Identity.sequence onchain. RecoveryRequested and
-- RecoveryExecuted only repeat a sequence snapshot and are intentionally
-- excluded. The legacy follow `sequence` fallback is conservative for rows
-- written before followerSequence and edgeStateSequence were projected
-- separately; a fresh chain replay will replace it with the exact value.
WITH sequence_candidates AS (
  SELECT
    event.network_id,
    event.slot,
    event.transaction_index,
    event.transaction_signature,
    event.log_index,
    CASE event.event_type
      WHEN 'handle-claimed' THEN event.event_body ->> 'identityId'
      WHEN 'handle-released' THEN event.event_body ->> 'identityId'
      WHEN 'root-authority-rotated' THEN event.event_body ->> 'identityId'
      WHEN 'delegation-created' THEN event.event_body ->> 'identityId'
      WHEN 'delegation-revoked' THEN event.event_body ->> 'identityId'
      WHEN 'profile-updated' THEN event.event_body ->> 'identityId'
      WHEN 'post-published' THEN event.event_body ->> 'identityId'
      WHEN 'follow-changed' THEN event.event_body ->> 'followerIdentityId'
      WHEN 'block-changed' THEN event.event_body ->> 'blockerIdentityId'
      WHEN 'tombstoned' THEN event.event_body ->> 'identityId'
      WHEN 'community-created' THEN event.event_body ->> 'creatorIdentityId'
      WHEN 'community-governance-updated' THEN event.event_body ->> 'creatorIdentityId'
      WHEN 'community-membership-changed' THEN event.event_body ->> 'assignedByIdentityId'
      WHEN 'reaction-changed' THEN event.event_body ->> 'reactorIdentityId'
      WHEN 'recovery-policy-configured' THEN event.event_body ->> 'identityId'
      WHEN 'recovery-policy-disabled' THEN event.event_body ->> 'identityId'
      WHEN 'recovery-cancelled' THEN event.event_body ->> 'identityId'
      WHEN 'proposal-created' THEN event.event_body ->> 'proposerIdentityId'
      WHEN 'vote-cast' THEN event.event_body ->> 'voterIdentityId'
      WHEN 'subscription-offering-created' THEN event.event_body ->> 'creatorIdentityId'
      WHEN 'subscription-offering-retired' THEN event.event_body ->> 'creatorIdentityId'
    END AS identity_id,
    CASE event.event_type
      WHEN 'handle-claimed' THEN event.event_body ->> 'identitySequence'
      WHEN 'handle-released' THEN event.event_body ->> 'identitySequence'
      WHEN 'root-authority-rotated' THEN event.event_body ->> 'identitySequence'
      WHEN 'delegation-created' THEN event.event_body ->> 'identitySequence'
      WHEN 'delegation-revoked' THEN event.event_body ->> 'identitySequence'
      WHEN 'profile-updated' THEN event.event_body ->> 'sequence'
      WHEN 'post-published' THEN event.event_body ->> 'sequence'
      WHEN 'follow-changed' THEN COALESCE(
        event.event_body ->> 'followerSequence',
        event.event_body ->> 'sequence'
      )
      WHEN 'block-changed' THEN event.event_body ->> 'blockerSequence'
      WHEN 'tombstoned' THEN event.event_body ->> 'sequence'
      WHEN 'community-created' THEN event.event_body ->> 'creatorSequence'
      WHEN 'community-governance-updated' THEN event.event_body ->> 'creatorSequence'
      WHEN 'community-membership-changed' THEN event.event_body ->> 'authoritySequence'
      WHEN 'reaction-changed' THEN event.event_body ->> 'reactorSequence'
      WHEN 'recovery-policy-configured' THEN event.event_body ->> 'identitySequence'
      WHEN 'recovery-policy-disabled' THEN event.event_body ->> 'identitySequence'
      WHEN 'recovery-cancelled' THEN event.event_body ->> 'identitySequence'
      WHEN 'proposal-created' THEN event.event_body ->> 'proposerSequence'
      WHEN 'vote-cast' THEN event.event_body ->> 'voterSequence'
      WHEN 'subscription-offering-created' THEN event.event_body ->> 'creatorSequence'
      WHEN 'subscription-offering-retired' THEN event.event_body ->> 'creatorSequence'
    END AS sequence_value
  FROM protocol_events AS event
  WHERE event.event_type IN (
    'handle-claimed',
    'handle-released',
    'root-authority-rotated',
    'delegation-created',
    'delegation-revoked',
    'profile-updated',
    'post-published',
    'follow-changed',
    'block-changed',
    'tombstoned',
    'community-created',
    'community-governance-updated',
    'community-membership-changed',
    'reaction-changed',
    'recovery-policy-configured',
    'recovery-policy-disabled',
    'recovery-cancelled',
    'proposal-created',
    'vote-cast',
    'subscription-offering-created',
    'subscription-offering-retired'
  )
),
ranked_sequences AS (
  SELECT
    candidate.*,
    row_number() OVER (
      PARTITION BY candidate.network_id, candidate.identity_id
      ORDER BY
        candidate.sequence_value::numeric DESC,
        candidate.slot DESC,
        candidate.transaction_index DESC NULLS LAST,
        candidate.transaction_signature DESC,
        candidate.log_index DESC
    ) AS rank
  FROM sequence_candidates AS candidate
  WHERE candidate.identity_id IS NOT NULL
    AND candidate.sequence_value ~ '^[0-9]{1,20}$'
    AND candidate.sequence_value::numeric <= 18446744073709551615
)
UPDATE identities AS identity
SET
  identity_sequence = ranked.sequence_value::numeric,
  sequence_slot = ranked.slot,
  sequence_transaction_index = ranked.transaction_index,
  sequence_transaction_signature = ranked.transaction_signature,
  sequence_log_index = ranked.log_index
FROM ranked_sequences AS ranked
WHERE ranked.rank = 1
  AND ranked.network_id = identity.network_id
  AND ranked.identity_id = identity.identity_id
  AND ranked.sequence_value::numeric >= identity.identity_sequence;

-- A retained deactivation is authoritative security state. Never silently skip
-- a malformed, orphaned, duplicated, non-advancing, or out-of-order row and
-- leave the identity active.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    LEFT JOIN identities AS identity
      ON identity.network_id = event.network_id
     AND identity.identity_id = event.event_body ->> 'identityId'
    WHERE event.event_type = 'identity-deactivated'
      AND (
        identity.identity_id IS NULL
        OR event.event_body ->> 'identitySequence' IS NULL
        OR event.event_body ->> 'identitySequence' !~ '^[0-9]{1,20}$'
      )
  ) THEN
    RAISE EXCEPTION
      'retained identity deactivation has an invalid identity or sequence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    JOIN identities AS identity
      ON identity.network_id = event.network_id
     AND identity.identity_id = event.event_body ->> 'identityId'
    WHERE event.event_type = 'identity-deactivated'
      AND (
        (event.event_body ->> 'identitySequence')::numeric > 18446744073709551615
        OR (event.event_body ->> 'identitySequence')::numeric <> identity.identity_sequence + 1
        OR event.slot < identity.sequence_slot
        OR (
          event.slot = identity.sequence_slot
          AND NOT (
            (
              event.transaction_signature = identity.sequence_transaction_signature
              AND event.transaction_index IS NOT DISTINCT FROM identity.sequence_transaction_index
              AND event.log_index > identity.sequence_log_index
            )
            OR
            (
              event.transaction_signature <> identity.sequence_transaction_signature
              AND event.transaction_index IS NOT NULL
              AND identity.sequence_transaction_index IS NOT NULL
              AND event.transaction_index > identity.sequence_transaction_index
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'retained identity deactivation does not advance the projected identity'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    WHERE event.event_type = 'identity-deactivated'
    GROUP BY event.network_id, event.event_body ->> 'identityId'
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION
      'retained identity has multiple deactivation events'
      USING ERRCODE = '23514';
  END IF;
END
$$;

WITH deactivations AS (
  SELECT
    event.network_id,
    event.event_body ->> 'identityId' AS identity_id,
    event.event_body ->> 'identitySequence' AS identity_sequence,
    event.slot,
    event.block_time,
    event.transaction_index,
    event.transaction_signature,
    event.log_index,
    row_number() OVER (
      PARTITION BY event.network_id, event.event_body ->> 'identityId'
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
    ) AS rank
  FROM protocol_events AS event
  WHERE event.event_type = 'identity-deactivated'
)
UPDATE identities AS identity
SET
  active = false,
  identity_sequence = deactivation.identity_sequence::numeric,
  sequence_slot = deactivation.slot,
  sequence_transaction_index = deactivation.transaction_index,
  sequence_transaction_signature = deactivation.transaction_signature,
  sequence_log_index = deactivation.log_index,
  deactivated_slot = deactivation.slot,
  deactivated_at = deactivation.block_time,
  deactivated_transaction_index = deactivation.transaction_index,
  deactivated_transaction_signature = deactivation.transaction_signature,
  deactivated_log_index = deactivation.log_index,
  updated_slot = deactivation.slot,
  updated_at = deactivation.block_time
FROM deactivations AS deactivation
WHERE deactivation.rank = 1
  AND deactivation.network_id = identity.network_id
  AND deactivation.identity_id = identity.identity_id
  AND deactivation.identity_sequence ~ '^[0-9]{1,20}$'
  AND deactivation.identity_sequence::numeric <= 18446744073709551615
  AND deactivation.identity_sequence::numeric = identity.identity_sequence + 1;

ALTER TABLE identities
  ALTER COLUMN sequence_slot SET DEFAULT 0,
  ALTER COLUMN sequence_transaction_signature SET DEFAULT 'legacy-identity-creation',
  ALTER COLUMN sequence_log_index SET DEFAULT 0,
  ALTER COLUMN sequence_slot SET NOT NULL,
  ALTER COLUMN sequence_transaction_signature SET NOT NULL,
  ALTER COLUMN sequence_log_index SET NOT NULL,
  ADD CONSTRAINT identities_identity_sequence_u64
    CHECK (identity_sequence >= 0 AND identity_sequence <= 18446744073709551615),
  ADD CONSTRAINT identities_sequence_slot_nonnegative
    CHECK (sequence_slot >= 0),
  ADD CONSTRAINT identities_sequence_transaction_index_nonnegative
    CHECK (sequence_transaction_index IS NULL OR sequence_transaction_index >= 0),
  ADD CONSTRAINT identities_sequence_log_index_nonnegative
    CHECK (sequence_log_index >= 0),
  ADD CONSTRAINT identities_deactivation_consistency
    CHECK (
      (
        active
        AND deactivated_slot IS NULL
        AND deactivated_at IS NULL
        AND deactivated_transaction_index IS NULL
        AND deactivated_transaction_signature IS NULL
        AND deactivated_log_index IS NULL
      )
      OR
      (
        NOT active
        AND deactivated_slot IS NOT NULL
        AND deactivated_at IS NOT NULL
        AND deactivated_transaction_signature IS NOT NULL
        AND deactivated_log_index IS NOT NULL
      )
    ),
  ADD CONSTRAINT identities_deactivated_slot_nonnegative
    CHECK (deactivated_slot IS NULL OR deactivated_slot >= 0),
  ADD CONSTRAINT identities_deactivated_transaction_index_nonnegative
    CHECK (
      deactivated_transaction_index IS NULL
      OR deactivated_transaction_index >= 0
    ),
  ADD CONSTRAINT identities_deactivated_log_index_nonnegative
    CHECK (deactivated_log_index IS NULL OR deactivated_log_index >= 0);

CREATE INDEX IF NOT EXISTS active_identities_by_network
  ON identities (network_id, identity_id)
  WHERE active;

-- Keep contains search on the trigram path even when PostgreSQL estimates a
-- network-scoped unique B-tree scan as deceptively cheap. The network predicate
-- remains mandatory in the query and is applied after this selective bitmap.
CREATE INDEX IF NOT EXISTS active_handles_public_search_contains
  ON handle_claims USING gin (search_handle gin_trgm_ops)
  WHERE active;
