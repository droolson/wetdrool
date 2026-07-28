-- Public search is a disposable projection, but its unauthenticated query path
-- must never issue a non-indexable substring predicate. PostgreSQL's normalize
-- function supplies the same NFKC representation used by the application.
-- pg_trgm makes contains predicates with an extractable ASCII alphanumeric
-- trigram indexable. Terms without one (for example "@ab", "!!!", or emoji)
-- are prefix-only and use the B-tree indexes below.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Keep normalization independent of the database locale. NFKC runs first,
-- every Unicode Separator run becomes one ASCII space, surrounding spaces are
-- removed, and only ASCII A-Z is case-folded. Non-ASCII text remains
-- case-sensitive by design so JavaScript and PostgreSQL cannot disagree.
CREATE OR REPLACE FUNCTION wokesocial_public_search_normalize(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
RETURN translate(
  btrim(
    regexp_replace(
      normalize(value, NFKC),
      U&'[ \00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+',
      ' ',
      'g'
    )
  ),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz'
);

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS search_identity_id text
  GENERATED ALWAYS AS (wokesocial_public_search_normalize(identity_id)) STORED;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS search_display_name text
  GENERATED ALWAYS AS (wokesocial_public_search_normalize(display_name)) STORED,
  ADD COLUMN IF NOT EXISTS search_bio text
  GENERATED ALWAYS AS (wokesocial_public_search_normalize(bio)) STORED,
  ADD COLUMN IF NOT EXISTS search_bio_prefix text
  GENERATED ALWAYS AS (
    left(wokesocial_public_search_normalize(bio), 512)
  ) STORED;

ALTER TABLE handle_claims
  ADD COLUMN IF NOT EXISTS search_handle text
  GENERATED ALWAYS AS (wokesocial_public_search_normalize(handle)) STORED;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS search_object_id text
  GENERATED ALWAYS AS (wokesocial_public_search_normalize(object_id)) STORED,
  ADD COLUMN IF NOT EXISTS search_body text
  GENERATED ALWAYS AS (
    wokesocial_public_search_normalize(
      COALESCE(body, content -> 'bodyReference' ->> 'cid', '')
    )
  ) STORED,
  ADD COLUMN IF NOT EXISTS search_body_prefix text
  GENERATED ALWAYS AS (
    left(
      wokesocial_public_search_normalize(
        COALESCE(body, content -> 'bodyReference' ->> 'cid', '')
      ),
      512
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS identities_public_search_prefix
  ON identities (network_id, search_identity_id text_pattern_ops);

CREATE INDEX IF NOT EXISTS profiles_public_name_search
  ON profiles USING gin (search_display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_public_name_search_prefix
  ON profiles (search_display_name text_pattern_ops);

CREATE INDEX IF NOT EXISTS profiles_public_bio_search
  ON profiles USING gin (search_bio gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_public_bio_search_prefix
  ON profiles (search_bio_prefix text_pattern_ops);

CREATE INDEX IF NOT EXISTS active_handles_public_search
  ON handle_claims USING gin (network_id, search_handle gin_trgm_ops)
  WHERE active;

CREATE INDEX IF NOT EXISTS active_handles_public_search_prefix
  ON handle_claims (network_id, search_handle text_pattern_ops)
  WHERE active;

CREATE INDEX IF NOT EXISTS active_handles_canonical_by_identity
  ON handle_claims (network_id, identity_id, handle COLLATE "C")
  WHERE active;

CREATE INDEX IF NOT EXISTS active_posts_public_search_identifier
  ON posts (network_id, search_object_id text_pattern_ops)
  WHERE tombstoned_at IS NULL
    AND content -> 'visibility' ->> 'kind' = 'public';

CREATE INDEX IF NOT EXISTS active_posts_public_search_body
  ON posts USING gin (network_id, search_body gin_trgm_ops)
  WHERE tombstoned_at IS NULL
    AND content -> 'visibility' ->> 'kind' = 'public';

CREATE INDEX IF NOT EXISTS active_posts_public_search_body_prefix
  ON posts (network_id, search_body_prefix text_pattern_ops)
  WHERE tombstoned_at IS NULL
    AND content -> 'visibility' ->> 'kind' = 'public';
