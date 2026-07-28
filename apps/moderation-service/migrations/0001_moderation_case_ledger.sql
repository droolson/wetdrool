CREATE TABLE moderation_public_objects (
  object_id text PRIMARY KEY,
  cid text NOT NULL,
  canonical_bytes bytea NOT NULL,
  author_id text NOT NULL,
  subject_key text NOT NULL,
  received_at timestamptz NOT NULL,
  expires_at timestamptz,
  supersedes_id text REFERENCES moderation_public_objects(object_id),
  CHECK (octet_length(canonical_bytes) BETWEEN 1 AND 196608)
);

CREATE UNIQUE INDEX moderation_public_one_replacement
  ON moderation_public_objects (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE INDEX moderation_public_active_subject
  ON moderation_public_objects (subject_key, expires_at, object_id);

CREATE TABLE moderation_restricted_objects (
  object_id text PRIMARY KEY,
  object_type text NOT NULL CHECK (object_type IN ('report', 'appeal')),
  cid text NOT NULL,
  received_at timestamptz NOT NULL,
  decision_id text,
  encrypted_payload jsonb NOT NULL,
  CHECK (
    (object_type = 'report' AND decision_id IS NULL)
    OR (object_type = 'appeal' AND decision_id IS NOT NULL)
  )
);

CREATE INDEX moderation_restricted_decision
  ON moderation_restricted_objects (decision_id, object_id)
  WHERE decision_id IS NOT NULL;

CREATE TABLE moderation_cases (
  report_id text PRIMARY KEY REFERENCES moderation_restricted_objects(object_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (
    state IN (
      'received',
      'awaiting-triage',
      'under-review',
      'information-requested',
      'action-taken',
      'no-action',
      'referred',
      'appealed',
      'closed'
    )
  ),
  version bigint NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX moderation_cases_retention
  ON moderation_cases (closed_at, report_id)
  WHERE state = 'closed' AND legal_hold = false;

CREATE TABLE moderation_case_events (
  event_id uuid PRIMARY KEY,
  report_id text NOT NULL REFERENCES moderation_cases(report_id) ON DELETE CASCADE,
  case_version bigint NOT NULL CHECK (case_version >= 1),
  event_type text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  encrypted_detail jsonb NOT NULL,
  UNIQUE (report_id, case_version)
);

CREATE INDEX moderation_case_events_report
  ON moderation_case_events (report_id, case_version);

CREATE TABLE moderation_actions (
  action_id uuid PRIMARY KEY,
  report_id text NOT NULL REFERENCES moderation_cases(report_id) ON DELETE CASCADE,
  action_kind text NOT NULL,
  created_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  review_due_at timestamptz,
  supersedes_action_id uuid REFERENCES moderation_actions(action_id),
  encrypted_detail jsonb NOT NULL,
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK (review_due_at IS NULL OR expires_at IS NOT NULL),
  CHECK (review_due_at IS NULL OR review_due_at < expires_at)
);

CREATE INDEX moderation_actions_due
  ON moderation_actions (review_due_at, expires_at, action_id);

CREATE TABLE moderation_action_status_events (
  event_id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES moderation_actions(action_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (
    status IN ('active', 'review-required', 'reviewed', 'reversed', 'expired')
  ),
  created_at timestamptz NOT NULL,
  encrypted_detail jsonb NOT NULL,
  UNIQUE (action_id, status)
);

CREATE INDEX moderation_action_status_history
  ON moderation_action_status_events (action_id, created_at, event_id);

CREATE TABLE moderation_reviews (
  review_id uuid PRIMARY KEY,
  report_id text NOT NULL REFERENCES moderation_cases(report_id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES moderation_actions(action_id) ON DELETE CASCADE,
  appeal_id text REFERENCES moderation_restricted_objects(object_id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('upheld', 'modified', 'reversed')),
  created_at timestamptz NOT NULL,
  encrypted_detail jsonb NOT NULL,
  UNIQUE NULLS NOT DISTINCT (action_id, appeal_id)
);

CREATE TABLE moderation_access_events (
  access_id uuid PRIMARY KEY,
  report_id text REFERENCES moderation_cases(report_id) ON DELETE SET NULL,
  operation text NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL,
  encrypted_detail jsonb NOT NULL
);

CREATE INDEX moderation_access_report
  ON moderation_access_events (report_id, created_at, access_id);

CREATE TABLE moderation_legal_hold_events (
  event_id uuid PRIMARY KEY,
  report_id text NOT NULL REFERENCES moderation_cases(report_id) ON DELETE CASCADE,
  active boolean NOT NULL,
  created_at timestamptz NOT NULL,
  encrypted_detail jsonb NOT NULL
);

CREATE INDEX moderation_legal_hold_history
  ON moderation_legal_hold_events (report_id, created_at, event_id);

CREATE OR REPLACE FUNCTION moderation_reject_ledger_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'moderation ledger rows are append-only';
END;
$$;

CREATE TRIGGER moderation_case_events_append_only
  BEFORE UPDATE ON moderation_case_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_actions_append_only
  BEFORE UPDATE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_action_status_append_only
  BEFORE UPDATE ON moderation_action_status_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_reviews_append_only
  BEFORE UPDATE ON moderation_reviews
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_access_append_only
  BEFORE UPDATE ON moderation_access_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();

CREATE TRIGGER moderation_legal_hold_append_only
  BEFORE UPDATE ON moderation_legal_hold_events
  FOR EACH ROW EXECUTE FUNCTION moderation_reject_ledger_update();
