ALTER TABLE moderation_reviews
  DROP CONSTRAINT moderation_reviews_appeal_id_fkey,
  ADD CONSTRAINT moderation_reviews_appeal_id_fkey
    FOREIGN KEY (appeal_id)
    REFERENCES moderation_restricted_objects(object_id)
    ON DELETE CASCADE;

ALTER TABLE moderation_access_events
  DROP CONSTRAINT moderation_access_events_report_id_fkey,
  ADD CONSTRAINT moderation_access_events_report_id_fkey
    FOREIGN KEY (report_id)
    REFERENCES moderation_cases(report_id)
    ON DELETE CASCADE;

ALTER TABLE moderation_actions
  ADD CONSTRAINT moderation_actions_review_after_effective
  CHECK (review_due_at IS NULL OR review_due_at > effective_at);

CREATE INDEX moderation_access_unlinked_retention
  ON moderation_access_events (created_at, access_id)
  WHERE report_id IS NULL;
