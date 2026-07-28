ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_terminal_fields_required
  CHECK (
    (
      outcome = 'pending'
      AND finalizer IS NULL
      AND participating_votes IS NULL
      AND decisive_votes IS NULL
      AND quorum_met IS NULL
      AND approval_met IS NULL
      AND finalized_slot IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      outcome IN ('accepted', 'rejected')
      AND finalizer IS NOT NULL
      AND participating_votes IS NOT NULL
      AND decisive_votes IS NOT NULL
      AND quorum_met IS NOT NULL
      AND approval_met IS NOT NULL
      AND finalized_slot IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  );
