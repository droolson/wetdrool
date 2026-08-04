ALTER TABLE protocol_events
  ADD COLUMN IF NOT EXISTS manifest_pending boolean NOT NULL DEFAULT false;

ALTER TABLE protocol_events
  DROP CONSTRAINT IF EXISTS protocol_events_manifest_disposition_check;

ALTER TABLE protocol_events
  ADD CONSTRAINT protocol_events_manifest_disposition_check
  CHECK (
    NOT (manifest_pending AND terminal_manifest_failure_code IS NOT NULL)
    AND (
      NOT manifest_pending
      OR event_type IN ('profile-updated', 'post-published')
    )
  );

CREATE INDEX IF NOT EXISTS indexer_dead_letters_due_manifest_hydration
  ON indexer_dead_letters (
    network_id,
    next_attempt_at,
    transaction_signature,
    log_index
  )
  WHERE next_attempt_at IS NOT NULL;

DO $manifest_ingestion_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM indexer_dead_letters AS dead
    LEFT JOIN protocol_events AS event
      ON event.network_id = dead.network_id
     AND event.transaction_signature = dead.transaction_signature
     AND event.log_index = dead.log_index
     AND NOT event.manifest_pending
     AND event.terminal_manifest_failure_code = dead.failure_code
    WHERE dead.next_attempt_at IS NULL
      AND event.network_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'terminal indexer dead letter does not exactly match a terminal raw protocol event'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM protocol_events AS event
    LEFT JOIN indexer_dead_letters AS dead
      ON dead.network_id = event.network_id
     AND dead.transaction_signature = event.transaction_signature
     AND dead.log_index = event.log_index
     AND dead.next_attempt_at IS NULL
     AND dead.failure_code = event.terminal_manifest_failure_code
    WHERE event.terminal_manifest_failure_code IS NOT NULL
      AND dead.network_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'terminal raw protocol event does not exactly match a terminal indexer dead letter'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM indexer_dead_letters AS dead
    LEFT JOIN protocol_events AS event
      ON event.network_id = dead.network_id
     AND event.transaction_signature = dead.transaction_signature
     AND event.log_index = dead.log_index
     AND event.manifest_pending
     AND event.terminal_manifest_failure_code IS NULL
    WHERE dead.failure_code = 'manifest-unavailable'
      AND dead.next_attempt_at IS NOT NULL
      AND event.network_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'retryable manifest-unavailable dead letter requires an exactly matching pending raw event'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$manifest_ingestion_preflight$;

DROP TRIGGER IF EXISTS protocol_events_terminal_manifest_failure_immutable
  ON protocol_events;
DROP FUNCTION IF EXISTS prevent_terminal_manifest_failure_reclassification();

CREATE OR REPLACE FUNCTION enforce_protocol_event_manifest_disposition_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'manifest_pending' - 'terminal_manifest_failure_code')
       IS DISTINCT FROM
     (to_jsonb(OLD) - 'manifest_pending' - 'terminal_manifest_failure_code') THEN
    RAISE EXCEPTION 'raw protocol event body and provenance are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.manifest_pending
     AND OLD.terminal_manifest_failure_code IS NULL
     AND NOT NEW.manifest_pending THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'manifest disposition is immutable except for one pending-to-accepted-or-terminal transition'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_manifest_ingestion_state_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  coordinate_network_id text;
  coordinate_transaction_signature text;
  coordinate_log_index integer;
  raw_exists boolean := false;
  raw_pending boolean;
  raw_terminal_code text;
  dead_exists boolean := false;
  dead_failure_code text;
  dead_next_attempt_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    coordinate_network_id := OLD.network_id;
    coordinate_transaction_signature := OLD.transaction_signature;
    coordinate_log_index := OLD.log_index;
  ELSE
    coordinate_network_id := NEW.network_id;
    coordinate_transaction_signature := NEW.transaction_signature;
    coordinate_log_index := NEW.log_index;
  END IF;

  SELECT event.manifest_pending, event.terminal_manifest_failure_code
  INTO raw_pending, raw_terminal_code
  FROM protocol_events AS event
  WHERE event.network_id = coordinate_network_id
    AND event.transaction_signature = coordinate_transaction_signature
    AND event.log_index = coordinate_log_index;
  raw_exists := FOUND;

  SELECT dead.failure_code, dead.next_attempt_at
  INTO dead_failure_code, dead_next_attempt_at
  FROM indexer_dead_letters AS dead
  WHERE dead.network_id = coordinate_network_id
    AND dead.transaction_signature = coordinate_transaction_signature
    AND dead.log_index = coordinate_log_index;
  dead_exists := FOUND;

  IF raw_exists AND raw_pending THEN
    IF NOT dead_exists
       OR dead_failure_code <> 'manifest-unavailable'
       OR dead_next_attempt_at IS NULL THEN
      RAISE EXCEPTION
        'pending raw manifest event requires a matching retryable manifest-unavailable dead letter'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF raw_exists AND raw_terminal_code IS NOT NULL THEN
    IF NOT dead_exists
       OR dead_failure_code <> raw_terminal_code
       OR dead_next_attempt_at IS NOT NULL THEN
      RAISE EXCEPTION
        'terminal raw manifest event requires an exactly matching terminal dead letter'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF dead_exists
     AND dead_next_attempt_at IS NULL
     AND (
       NOT raw_exists
       OR raw_pending
       OR raw_terminal_code IS NULL
       OR raw_terminal_code <> dead_failure_code
     ) THEN
    RAISE EXCEPTION
      'terminal indexer dead letter requires an exactly matching terminal raw protocol event'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF dead_exists
     AND dead_failure_code = 'manifest-unavailable'
     AND dead_next_attempt_at IS NOT NULL
     AND (
       NOT raw_exists
       OR NOT raw_pending
       OR raw_terminal_code IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'retryable manifest-unavailable dead letter requires an exactly matching pending raw event'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS protocol_events_manifest_disposition_immutable
  ON protocol_events;
CREATE TRIGGER protocol_events_manifest_disposition_immutable
BEFORE UPDATE ON protocol_events
FOR EACH ROW
EXECUTE FUNCTION enforce_protocol_event_manifest_disposition_transition();

DROP TRIGGER IF EXISTS protocol_events_manifest_ingestion_consistent
  ON protocol_events;
CREATE CONSTRAINT TRIGGER protocol_events_manifest_ingestion_consistent
AFTER INSERT OR UPDATE OR DELETE ON protocol_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_manifest_ingestion_state_consistency();

DROP TRIGGER IF EXISTS indexer_dead_letters_manifest_ingestion_consistent
  ON indexer_dead_letters;
CREATE CONSTRAINT TRIGGER indexer_dead_letters_manifest_ingestion_consistent
AFTER INSERT OR UPDATE OR DELETE ON indexer_dead_letters
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_manifest_ingestion_state_consistency();

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
SET search_path = pg_catalog, wetdrool_indexer
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE wetdrool_indexer.protocol_events
  SET manifest_pending = false
  WHERE network_id = p_network_id
    AND transaction_signature = p_transaction_signature
    AND transaction_index IS NOT DISTINCT FROM p_transaction_index
    AND log_index = p_log_index
    AND slot = p_slot
    AND block_time = p_block_time
    AND event_type = p_event_type
    AND event_type IN ('profile-updated', 'post-published')
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
SET search_path = pg_catalog, wetdrool_indexer
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE wetdrool_indexer.protocol_events
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
    AND event_type IN ('profile-updated', 'post-published')
    AND event_body = p_event_body
    AND manifest_pending
    AND terminal_manifest_failure_code IS NULL;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION enforce_protocol_event_manifest_disposition_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_manifest_ingestion_state_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_pending_manifest_event(
  text, text, integer, integer, numeric, timestamptz, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_pending_manifest_event(
  text, text, integer, integer, numeric, timestamptz, text, jsonb, text
) FROM PUBLIC;

REVOKE UPDATE, DELETE ON TABLE protocol_events FROM PUBLIC;

DO $manifest_ingestion_runtime_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wetdrool_indexer_runtime') THEN
    REVOKE UPDATE, DELETE ON TABLE protocol_events FROM wetdrool_indexer_runtime;
    GRANT EXECUTE ON FUNCTION accept_pending_manifest_event(
      text, text, integer, integer, numeric, timestamptz, text, jsonb
    ) TO wetdrool_indexer_runtime;
    GRANT EXECUTE ON FUNCTION reject_pending_manifest_event(
      text, text, integer, integer, numeric, timestamptz, text, jsonb, text
    ) TO wetdrool_indexer_runtime;
  END IF;
END
$manifest_ingestion_runtime_acl$;
