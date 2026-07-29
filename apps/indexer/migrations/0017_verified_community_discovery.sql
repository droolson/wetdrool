ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_manifest_verified_check;

ALTER TABLE communities
  RENAME COLUMN authority TO latest_action_authority;

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS manifest_authority text,
  ADD COLUMN IF NOT EXISTS manifest_governance_version integer,
  ADD COLUMN IF NOT EXISTS manifest_governance_strategy_hash text;

UPDATE communities AS community
SET
  manifest_authority = COALESCE(
    (
      SELECT event.event_body ->> 'authority'
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-created'
        AND event.event_body ->> 'communityAddress' = community.community_address
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
      LIMIT 1
    ),
    (
      SELECT history.authority
      FROM community_governance_history AS history
      WHERE history.network_id = community.network_id
        AND history.community_address = community.community_address
      ORDER BY history.updated_slot, history.governance_version
      LIMIT 1
    )
  ),
  manifest_governance_version = COALESCE(
    (
      SELECT (event.event_body ->> 'governanceVersion')::integer
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-created'
        AND event.event_body ->> 'communityAddress' = community.community_address
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
      LIMIT 1
    ),
    (
      SELECT history.governance_version
      FROM community_governance_history AS history
      WHERE history.network_id = community.network_id
        AND history.community_address = community.community_address
      ORDER BY history.updated_slot, history.governance_version
      LIMIT 1
    )
  ),
  manifest_governance_strategy_hash = COALESCE(
    (
      SELECT event.event_body ->> 'governanceStrategyHash'
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-created'
        AND event.event_body ->> 'communityAddress' = community.community_address
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
      LIMIT 1
    ),
    (
      SELECT history.strategy_hash
      FROM community_governance_history AS history
      WHERE history.network_id = community.network_id
        AND history.community_address = community.community_address
      ORDER BY history.updated_slot, history.governance_version
      LIMIT 1
    )
  )
WHERE manifest_authority IS NULL
   OR manifest_governance_version IS NULL
   OR manifest_governance_strategy_hash IS NULL;

DO $manifest_authority_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM communities
    WHERE manifest_authority IS NULL
       OR manifest_governance_version IS NULL
       OR manifest_governance_strategy_hash IS NULL
  ) THEN
    RAISE EXCEPTION
      'community shell has no complete immutable creation binding in raw events or governance history'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$manifest_authority_preflight$;

ALTER TABLE communities
  ALTER COLUMN manifest_authority SET NOT NULL,
  ALTER COLUMN manifest_governance_version SET NOT NULL,
  ALTER COLUMN manifest_governance_strategy_hash SET NOT NULL;

ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_governance_advances_manifest_check;

ALTER TABLE communities
  ADD CONSTRAINT communities_governance_advances_manifest_check
  CHECK (
    governance_version >= manifest_governance_version
    AND (
      governance_version <> manifest_governance_version
      OR governance_strategy_hash = manifest_governance_strategy_hash
    )
  );

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS object_id text,
  ADD COLUMN IF NOT EXISTS schema_version integer,
  ADD COLUMN IF NOT EXISTS signing_key_id text,
  ADD COLUMN IF NOT EXISTS manifest_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS content jsonb;

ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_manifest_binding_check;

ALTER TABLE communities
  ADD CONSTRAINT communities_manifest_binding_check
  CHECK (
    (
      NOT manifest_verified
      AND object_id IS NULL
      AND schema_version IS NULL
      AND signing_key_id IS NULL
      AND manifest_created_at IS NULL
      AND content IS NULL
    )
    OR
    (
      manifest_verified
      AND object_id IS NOT NULL
      AND schema_version = 2
      AND signing_key_id =
        creator_identity_id || '#root/' || manifest_authority
      AND manifest_created_at IS NOT NULL
      AND manifest_governance_version = 1
      AND manifest_governance_strategy_hash =
        'uneRbAxLESnjaTD1GsoKoiIrsZg1CJCoNdhODS5Q1dXE'
      AND jsonb_typeof(content) = 'object'
      AND content ->> 'visibility' IN ('public', 'unlisted', 'private', 'restricted')
      AND content -> 'replacement' ->> 'sequence' = '1'
      AND NOT (content -> 'replacement' ? 'replaces')
      AND content -> 'governance' = jsonb_build_object(
        'model', 'one-active-member-one-vote',
        'version', 1,
        'quorumBasisPoints', 5000,
        'approvalBasisPoints', 5001,
        'abstainTreatment', 'quorum-only',
        'execution', 'outcome-record-only'
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS communities_verified_object_id
  ON communities (network_id, object_id)
  WHERE manifest_verified;

CREATE INDEX IF NOT EXISTS communities_public_directory
  ON communities (network_id, created_slot DESC, community_address COLLATE "C" DESC)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS search_name text
  GENERATED ALWAYS AS (
    wokesocial_public_search_normalize(COALESCE(content ->> 'name', ''))
  ) STORED,
  ADD COLUMN IF NOT EXISTS search_slug text
  GENERATED ALWAYS AS (
    wokesocial_public_search_normalize(COALESCE(content ->> 'slug', ''))
  ) STORED,
  ADD COLUMN IF NOT EXISTS search_description text
  GENERATED ALWAYS AS (
    wokesocial_public_search_normalize(COALESCE(content ->> 'description', ''))
  ) STORED,
  ADD COLUMN IF NOT EXISTS search_description_prefix text
  GENERATED ALWAYS AS (
    left(
      wokesocial_public_search_normalize(COALESCE(content ->> 'description', '')),
      512
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS communities_public_name_search
  ON communities USING gin (network_id, search_name gin_trgm_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

CREATE INDEX IF NOT EXISTS communities_public_name_search_prefix
  ON communities (network_id, search_name text_pattern_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

CREATE INDEX IF NOT EXISTS communities_public_slug_search
  ON communities USING gin (network_id, search_slug gin_trgm_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

CREATE INDEX IF NOT EXISTS communities_public_slug_search_prefix
  ON communities (network_id, search_slug text_pattern_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

CREATE INDEX IF NOT EXISTS communities_public_description_search
  ON communities USING gin (network_id, search_description gin_trgm_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

CREATE INDEX IF NOT EXISTS communities_public_description_search_prefix
  ON communities (network_id, search_description_prefix text_pattern_ops)
  WHERE manifest_verified
    AND content ->> 'visibility' = 'public';

ALTER TABLE governance_proposals
  DROP CONSTRAINT IF EXISTS governance_proposals_governance_strategy_hash_check;

ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_governance_strategy_hash_check
  CHECK (
    governance_strategy_hash IN (
      'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA',
      'uneRbAxLESnjaTD1GsoKoiIrsZg1CJCoNdhODS5Q1dXE'
    )
  );

ALTER TABLE protocol_events
  DROP CONSTRAINT IF EXISTS protocol_events_manifest_disposition_check;

ALTER TABLE protocol_events
  ADD CONSTRAINT protocol_events_manifest_disposition_check
  CHECK (
    NOT (manifest_pending AND terminal_manifest_failure_code IS NOT NULL)
    AND (
      NOT manifest_pending
      OR event_type IN ('profile-updated', 'post-published', 'community-created')
    )
  );

CREATE OR REPLACE FUNCTION accept_pending_manifest_event(
  p_network_id text,
  p_transaction_signature text,
  p_transaction_index integer,
  p_log_index integer,
  p_slot numeric,
  p_block_time timestamptz,
  p_event_type text,
  p_event_body jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, wokesocial_indexer
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE wokesocial_indexer.protocol_events
  SET manifest_pending = false
  WHERE network_id = p_network_id
    AND transaction_signature = p_transaction_signature
    AND transaction_index IS NOT DISTINCT FROM p_transaction_index
    AND log_index = p_log_index
    AND slot = p_slot
    AND block_time = p_block_time
    AND event_type = p_event_type
    AND event_type IN ('profile-updated', 'post-published', 'community-created')
    AND event_body = p_event_body
    AND manifest_pending
    AND terminal_manifest_failure_code IS NULL;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION reject_pending_manifest_event(
  p_network_id text,
  p_transaction_signature text,
  p_transaction_index integer,
  p_log_index integer,
  p_slot numeric,
  p_block_time timestamptz,
  p_event_type text,
  p_event_body jsonb,
  p_terminal_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, wokesocial_indexer
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE wokesocial_indexer.protocol_events
  SET
    manifest_pending = false,
    terminal_manifest_failure_code = p_terminal_failure_code
  WHERE network_id = p_network_id
    AND transaction_signature = p_transaction_signature
    AND transaction_index IS NOT DISTINCT FROM p_transaction_index
    AND log_index = p_log_index
    AND slot = p_slot
    AND block_time = p_block_time
    AND event_type = p_event_type
    AND event_type IN ('profile-updated', 'post-published', 'community-created')
    AND event_body = p_event_body
    AND manifest_pending
    AND terminal_manifest_failure_code IS NULL;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

DO $legacy_community_manifest_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    LEFT JOIN communities AS community
      ON community.network_id = event.network_id
     AND community.community_address = event.event_body ->> 'communityAddress'
    WHERE event.event_type = 'community-created'
      AND NOT event.manifest_pending
      AND event.terminal_manifest_failure_code IS NULL
      AND community.community_address IS NULL
  ) THEN
    RAISE EXCEPTION
      'accepted legacy community event is missing its retained projection shell'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    JOIN indexer_dead_letters AS dead
      ON dead.network_id = event.network_id
     AND dead.transaction_signature = event.transaction_signature
     AND dead.log_index = event.log_index
    WHERE event.event_type = 'community-created'
      AND NOT event.manifest_pending
      AND event.terminal_manifest_failure_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'accepted legacy community event conflicts with an existing dead letter'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$legacy_community_manifest_preflight$;

DROP TRIGGER IF EXISTS protocol_events_manifest_disposition_immutable
  ON protocol_events;

WITH requeued AS (
  UPDATE protocol_events
  SET manifest_pending = true
  WHERE event_type = 'community-created'
    AND NOT manifest_pending
    AND terminal_manifest_failure_code IS NULL
  RETURNING network_id, transaction_signature, log_index, event_body
)
INSERT INTO indexer_dead_letters (
  network_id,
  transaction_signature,
  log_index,
  event_body,
  failure_code,
  failure_detail,
  next_attempt_at
)
SELECT
  network_id,
  transaction_signature,
  log_index,
  event_body,
  'manifest-unavailable',
  'Legacy community shell is awaiting signed-manifest verification.',
  now()
FROM requeued;

CREATE TRIGGER protocol_events_manifest_disposition_immutable
BEFORE UPDATE ON protocol_events
FOR EACH ROW
EXECUTE FUNCTION enforce_protocol_event_manifest_disposition_transition();
