ALTER TABLE protocol_events
  ADD COLUMN IF NOT EXISTS terminal_manifest_failure_code text;

ALTER TABLE protocol_events
  DROP CONSTRAINT IF EXISTS protocol_events_terminal_manifest_failure_code_check;

ALTER TABLE protocol_events
  ADD CONSTRAINT protocol_events_terminal_manifest_failure_code_check
  CHECK (
    terminal_manifest_failure_code IS NULL
    OR (
      event_type IN ('profile-updated', 'post-published', 'tombstoned')
      AND terminal_manifest_failure_code IN (
        'author-mismatch',
        'cid-mismatch',
        'hash-mismatch',
        'manifest-invalid',
        'manifest-uri',
        'object-mismatch',
        'schema-version',
        'type-mismatch',
        'unauthorized-key',
        'unsupported-event'
      )
    )
  );

CREATE INDEX IF NOT EXISTS protocol_events_terminal_manifest_failures
  ON protocol_events (network_id, slot, transaction_signature, log_index)
  WHERE terminal_manifest_failure_code IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_terminal_manifest_failure_reclassification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.terminal_manifest_failure_code
       IS DISTINCT FROM OLD.terminal_manifest_failure_code THEN
    RAISE EXCEPTION 'terminal manifest failure classification is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocol_events_terminal_manifest_failure_immutable
  ON protocol_events;

CREATE TRIGGER protocol_events_terminal_manifest_failure_immutable
BEFORE UPDATE OF terminal_manifest_failure_code ON protocol_events
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_manifest_failure_reclassification();

REVOKE ALL ON FUNCTION prevent_terminal_manifest_failure_reclassification() FROM PUBLIC;
