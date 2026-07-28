ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_nonzero_manifest_hash
  CHECK (manifest_hash <> 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
