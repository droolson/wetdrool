-- A signed manifest's creation timestamp is author-controlled metadata. Feed
-- chronology must use the finalized post-published event time instead.
DO $canonical_post_chronology_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM posts AS post
    CROSS JOIN LATERAL (
      SELECT count(*) AS match_count
      FROM protocol_events AS protocol_event
      WHERE protocol_event.network_id = post.network_id
        AND protocol_event.transaction_signature = post.transaction_signature
        AND protocol_event.event_type = 'post-published'
        AND protocol_event.event_body ->> 'objectId' = post.object_id
    ) AS matches
    WHERE matches.match_count <> 1
  ) THEN
    RAISE EXCEPTION
      'Every projected post must have exactly one matching immutable post-published event before canonical chronology can be backfilled.';
  END IF;
END
$canonical_post_chronology_preflight$;

UPDATE posts AS post
SET created_at = protocol_event.block_time
FROM protocol_events AS protocol_event
WHERE protocol_event.network_id = post.network_id
  AND protocol_event.transaction_signature = post.transaction_signature
  AND protocol_event.event_type = 'post-published'
  AND protocol_event.event_body ->> 'objectId' = post.object_id
  AND post.created_at IS DISTINCT FROM protocol_event.block_time;

DROP INDEX IF EXISTS posts_chronological;
CREATE INDEX posts_chronological
  ON posts (created_at DESC, object_id COLLATE "C" DESC)
  WHERE tombstoned_at IS NULL
    AND content -> 'visibility' ->> 'kind' = 'public';
