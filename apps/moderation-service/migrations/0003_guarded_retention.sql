CREATE OR REPLACE FUNCTION moderation_reject_ledger_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    TG_OP = 'DELETE'
    AND current_user = 'wokesocial_moderation_migration'
    AND current_setting('wokesocial.retention_delete', true) = 'on'
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'moderation ledger rows are append-only outside guarded retention';
END;
$$;

DROP TRIGGER IF EXISTS moderation_case_events_append_only ON moderation_case_events;
CREATE TRIGGER moderation_case_events_append_only
  BEFORE UPDATE OR DELETE ON moderation_case_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP TRIGGER IF EXISTS moderation_actions_append_only ON moderation_actions;
CREATE TRIGGER moderation_actions_append_only
  BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP TRIGGER IF EXISTS moderation_action_status_append_only ON moderation_action_status_events;
CREATE TRIGGER moderation_action_status_append_only
  BEFORE UPDATE OR DELETE ON moderation_action_status_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP TRIGGER IF EXISTS moderation_reviews_append_only ON moderation_reviews;
CREATE TRIGGER moderation_reviews_append_only
  BEFORE UPDATE OR DELETE ON moderation_reviews
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP TRIGGER IF EXISTS moderation_access_append_only ON moderation_access_events;
CREATE TRIGGER moderation_access_append_only
  BEFORE UPDATE OR DELETE ON moderation_access_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP TRIGGER IF EXISTS moderation_legal_hold_append_only ON moderation_legal_hold_events;
CREATE TRIGGER moderation_legal_hold_append_only
  BEFORE UPDATE OR DELETE ON moderation_legal_hold_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_cases_delete_guard
  BEFORE DELETE ON moderation_cases
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_restricted_objects_delete_guard
  BEFORE UPDATE OR DELETE ON moderation_restricted_objects
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_public_objects_immutable
  BEFORE UPDATE OR DELETE ON moderation_public_objects
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

DROP FUNCTION IF EXISTS moderation_apply_retention(timestamptz, integer);

DO $wokesocial_restrict_moderation_runtime$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'wokesocial_moderation_runtime'
  ) THEN
    REVOKE UPDATE, DELETE
      ON ALL TABLES IN SCHEMA wokesocial_moderation
      FROM wokesocial_moderation_runtime;
    GRANT UPDATE
      ON TABLE
        moderation_cases,
        moderation_public_objects,
        moderation_restricted_objects,
        moderation_actions
      TO wokesocial_moderation_runtime;
  END IF;
END
$wokesocial_restrict_moderation_runtime$;
