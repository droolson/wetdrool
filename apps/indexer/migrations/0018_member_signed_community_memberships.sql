DO $wetdrool_membership_v2_predeployment_reset$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM protocol_events
    WHERE event_type IN (
      'community-created',
      'community-membership-changed',
      'proposal-created'
    )
  )
  OR EXISTS (SELECT 1 FROM communities)
  OR EXISTS (SELECT 1 FROM community_memberships)
  OR EXISTS (SELECT 1 FROM governance_proposals)
  THEN
    RAISE EXCEPTION
      '0018 changes the predeployment community, membership, and proposal ABI; discard the disposable PostgreSQL projection and local-validator ledger before applying this migration';
  END IF;
END
$wetdrool_membership_v2_predeployment_reset$;

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS visibility text,
  ADD COLUMN IF NOT EXISTS membership_policy text,
  ADD COLUMN IF NOT EXISTS membership_policy_sequence numeric(20, 0),
  ADD COLUMN IF NOT EXISTS membership_sequence numeric(20, 0);

UPDATE communities AS community
SET
  visibility = COALESCE(
    (
      SELECT event.event_body ->> 'visibility'
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
    CASE community.content ->> 'visibility'
      WHEN 'public' THEN 'public'
      WHEN 'unlisted' THEN 'unlisted'
      ELSE 'private'
    END
  ),
  membership_policy = COALESCE(
    (
      SELECT event.event_body ->> 'membershipPolicy'
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
    community.content ->> 'membershipPolicy',
    'invite'
  ),
  membership_policy_sequence = COALESCE(
    (
      SELECT (event.event_body ->> 'membershipPolicySequence')::numeric
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-created'
        AND event.event_body ->> 'communityAddress' = community.community_address
        AND event.event_body ->> 'membershipPolicySequence' ~ '^[1-9][0-9]{0,19}$'
      ORDER BY
        event.slot,
        event.transaction_index NULLS LAST,
        event.transaction_signature,
        event.log_index
      LIMIT 1
    ),
    1
  ),
  membership_sequence = COALESCE(
    (
      SELECT max((event.event_body ->> 'communityMembershipSequence')::numeric)
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-membership-changed'
        AND event.event_body ->> 'communityAddress' = community.community_address
        AND event.event_body ->> 'communityMembershipSequence' ~ '^[1-9][0-9]{0,19}$'
    ),
    (
      SELECT count(*)::numeric
      FROM protocol_events AS event
      WHERE event.network_id = community.network_id
        AND event.event_type = 'community-membership-changed'
        AND event.event_body ->> 'communityAddress' = community.community_address
    ),
    0
  )
WHERE visibility IS NULL
   OR membership_policy IS NULL
   OR membership_policy_sequence IS NULL
   OR membership_sequence IS NULL;

ALTER TABLE communities
  ALTER COLUMN visibility SET NOT NULL,
  ALTER COLUMN membership_policy SET NOT NULL,
  ALTER COLUMN membership_policy_sequence SET NOT NULL,
  ALTER COLUMN membership_sequence SET NOT NULL;

ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_effective_membership_policy_check;

ALTER TABLE communities
  ADD CONSTRAINT communities_effective_membership_policy_check
  CHECK (
    visibility IN ('public', 'unlisted', 'private')
    AND membership_policy IN ('open', 'request', 'invite')
    AND membership_policy_sequence > 0
    AND membership_sequence >= 0
    AND (
      NOT manifest_verified
      OR (
        visibility = CASE content ->> 'visibility'
          WHEN 'public' THEN 'public'
          WHEN 'unlisted' THEN 'unlisted'
          ELSE 'private'
        END
        AND membership_policy = content ->> 'membershipPolicy'
      )
    )
  );

ALTER TABLE governance_proposals
  ADD COLUMN IF NOT EXISTS community_membership_sequence numeric(20, 0);

UPDATE governance_proposals AS proposal
SET community_membership_sequence = COALESCE(
  (
    SELECT (event.event_body ->> 'communityMembershipSequence')::numeric
    FROM protocol_events AS event
    WHERE event.network_id = proposal.network_id
      AND event.event_type = 'proposal-created'
      AND event.event_body ->> 'proposalAddress' = proposal.proposal_address
      AND event.event_body ->> 'communityMembershipSequence' ~ '^[0-9]{1,20}$'
    ORDER BY
      event.slot,
      event.transaction_index NULLS LAST,
      event.transaction_signature,
      event.log_index
    LIMIT 1
  ),
  0
)
WHERE community_membership_sequence IS NULL;

ALTER TABLE governance_proposals
  ALTER COLUMN community_membership_sequence SET NOT NULL;

ALTER TABLE governance_proposals
  DROP CONSTRAINT IF EXISTS governance_proposals_community_membership_sequence_check;

ALTER TABLE governance_proposals
  ADD CONSTRAINT governance_proposals_community_membership_sequence_check
  CHECK (community_membership_sequence >= 0);

ALTER TABLE community_memberships
  RENAME COLUMN assigned_by_identity_id TO actor_identity_id;

ALTER TABLE community_memberships
  RENAME COLUMN authority_sequence TO actor_sequence;

ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS member_action_sequence numeric(20, 0),
  ADD COLUMN IF NOT EXISTS membership_policy_sequence numeric(20, 0),
  ADD COLUMN IF NOT EXISTS community_membership_sequence numeric(20, 0),
  ADD COLUMN IF NOT EXISTS active_since_membership_sequence numeric(20, 0),
  ADD COLUMN IF NOT EXISTS manifest_cid text,
  ADD COLUMN IF NOT EXISTS manifest_hash text,
  ADD COLUMN IF NOT EXISTS manifest_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS object_id text,
  ADD COLUMN IF NOT EXISTS signing_key_id text,
  ADD COLUMN IF NOT EXISTS manifest_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS transaction_signature text,
  ADD COLUMN IF NOT EXISTS transaction_index integer,
  ADD COLUMN IF NOT EXISTS log_index integer;

WITH ordered AS (
  SELECT
    membership.network_id,
    membership.membership_address,
    row_number() OVER (
      PARTITION BY membership.network_id, membership.community_address
      ORDER BY
        membership.updated_slot,
        membership.membership_address COLLATE "C"
    )::numeric AS community_membership_sequence
  FROM community_memberships AS membership
)
UPDATE community_memberships AS membership
SET
  action = CASE WHEN membership.active THEN 'join' ELSE 'remove' END,
  state = CASE WHEN membership.active THEN 'active' ELSE 'removed' END,
  -- Legacy rows could carry moderator/admin bits (3/5/7). Membership v2 has
  -- one portable role only, so preserve active membership without carrying
  -- authority-assigned privilege bits into the member-signed model.
  roles = CASE WHEN membership.active THEN 1 ELSE 0 END,
  member_action_sequence = greatest(membership.state_sequence, 1),
  membership_policy_sequence = community.membership_policy_sequence,
  community_membership_sequence = ordered.community_membership_sequence,
  active_since_membership_sequence =
    CASE WHEN membership.active THEN ordered.community_membership_sequence ELSE 0 END
FROM ordered, communities AS community
WHERE membership.network_id = ordered.network_id
  AND membership.membership_address = ordered.membership_address
  AND community.network_id = membership.network_id
  AND community.community_address = membership.community_address
  AND (
    membership.action IS NULL
    OR membership.state IS NULL
    OR membership.member_action_sequence IS NULL
    OR membership.membership_policy_sequence IS NULL
    OR membership.community_membership_sequence IS NULL
    OR membership.active_since_membership_sequence IS NULL
  );

WITH latest AS (
  SELECT DISTINCT ON (
    event.network_id,
    event.event_body ->> 'membershipAddress'
  )
    event.network_id,
    event.event_body ->> 'membershipAddress' AS membership_address,
    event.transaction_signature,
    event.transaction_index,
    event.log_index
  FROM protocol_events AS event
  WHERE event.event_type = 'community-membership-changed'
    AND event.event_body ? 'membershipAddress'
  ORDER BY
    event.network_id,
    event.event_body ->> 'membershipAddress',
    event.slot DESC,
    event.transaction_index DESC NULLS LAST,
    event.transaction_signature DESC,
    event.log_index DESC
)
UPDATE community_memberships AS membership
SET
  transaction_signature = latest.transaction_signature,
  transaction_index = latest.transaction_index,
  log_index = latest.log_index
FROM latest
WHERE membership.network_id = latest.network_id
  AND membership.membership_address = latest.membership_address
  AND membership.transaction_signature IS NULL;

UPDATE communities AS community
SET membership_sequence = greatest(
  community.membership_sequence,
  COALESCE(
    (
      SELECT max(membership.community_membership_sequence)
      FROM community_memberships AS membership
      WHERE membership.network_id = community.network_id
        AND membership.community_address = community.community_address
    ),
    0
  )
);

ALTER TABLE community_memberships
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN member_action_sequence SET NOT NULL,
  ALTER COLUMN membership_policy_sequence SET NOT NULL,
  ALTER COLUMN community_membership_sequence SET NOT NULL,
  ALTER COLUMN active_since_membership_sequence SET NOT NULL;

ALTER TABLE community_memberships
  DROP CONSTRAINT IF EXISTS community_memberships_check,
  DROP CONSTRAINT IF EXISTS community_memberships_state_check,
  DROP CONSTRAINT IF EXISTS community_memberships_manifest_check,
  DROP CONSTRAINT IF EXISTS community_memberships_provenance_check;

ALTER TABLE community_memberships
  ADD CONSTRAINT community_memberships_state_check
  CHECK (
    (action = 'join' AND state = 'active' AND active AND roles = 1
      AND active_since_membership_sequence = community_membership_sequence)
    OR
    (action = 'leave' AND state = 'left' AND NOT active AND roles = 0
      AND active_since_membership_sequence = 0)
    OR
    (action = 'remove' AND state = 'removed' AND NOT active AND roles = 0
      AND active_since_membership_sequence = 0)
    OR
    (action = 'ban' AND state = 'banned' AND NOT active AND roles = 0
      AND active_since_membership_sequence = 0)
  ),
  ADD CONSTRAINT community_memberships_manifest_check
  CHECK (
    member_action_sequence > 0
    AND membership_policy_sequence > 0
    AND community_membership_sequence > 0
    AND (
      NOT manifest_verified
      OR (
        manifest_cid IS NOT NULL
        AND manifest_hash IS NOT NULL
        AND object_id IS NOT NULL
        AND signing_key_id IS NOT NULL
        AND manifest_created_at IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT community_memberships_provenance_check
  CHECK (
    (
      transaction_signature IS NULL
      AND transaction_index IS NULL
      AND log_index IS NULL
    )
    OR
    (
      transaction_signature IS NOT NULL
      AND log_index IS NOT NULL
      AND (transaction_index IS NULL OR transaction_index >= 0)
    )
  );

CREATE INDEX IF NOT EXISTS community_memberships_exact_status
  ON community_memberships (network_id, membership_address)
  WHERE manifest_verified;

ALTER TABLE protocol_events
  DROP CONSTRAINT IF EXISTS protocol_events_manifest_disposition_check;

ALTER TABLE protocol_events
  ADD CONSTRAINT protocol_events_manifest_disposition_check
  CHECK (
    NOT (manifest_pending AND terminal_manifest_failure_code IS NOT NULL)
    AND (
      NOT manifest_pending
      OR event_type IN (
        'profile-updated',
        'post-published',
        'community-created',
        'community-membership-changed'
      )
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
    AND event_type IN (
      'profile-updated',
      'post-published',
      'community-created',
      'community-membership-changed'
    )
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
    AND event_type IN (
      'profile-updated',
      'post-published',
      'community-created',
      'community-membership-changed'
    )
    AND event_body = p_event_body
    AND manifest_pending
    AND terminal_manifest_failure_code IS NULL;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;
