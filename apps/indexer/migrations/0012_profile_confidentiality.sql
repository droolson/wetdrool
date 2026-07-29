ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS content jsonb;

-- Legacy projections may contain the old visibility-plus-plaintext pronoun
-- shape. Preserve only explicitly public values while upgrading; protected
-- plaintext must not survive in the new public profile projection.
UPDATE profiles
SET content = jsonb_build_object(
  'displayName', display_name,
  'bio', bio,
  'pronouns',
    COALESCE(
      (
        SELECT jsonb_agg(legacy.entry ORDER BY legacy.position)
        FROM jsonb_array_elements(profiles.pronouns)
          WITH ORDINALITY AS legacy(entry, position)
        WHERE legacy.entry ->> 'visibility' = 'public'
          AND jsonb_typeof(legacy.entry -> 'value') = 'string'
      ),
      '[]'::jsonb
    ),
  'chosenFamilyLabels', '[]'::jsonb,
  'links', '[]'::jsonb
)
WHERE content IS NULL;

-- Defensively normalize any populated `content` column left by an interrupted
-- or prerelease deployment. Frozen v1 chosen-family labels and location had no
-- explicit visibility, so they are not carried into a public projection.
-- Current protected-value objects survive only when explicitly public. The
-- legacy-only `genderVisibility` field is never copied.
UPDATE profiles
SET content =
  jsonb_build_object(
    'displayName', display_name,
    'bio', bio,
    'pronouns',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'visibility', 'public',
              'value', item.entry -> 'value'
            )
            ORDER BY item.position
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(profiles.content -> 'pronouns') = 'array'
                THEN profiles.content -> 'pronouns'
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS item(entry, position)
          WHERE jsonb_typeof(item.entry) = 'object'
            AND item.entry ->> 'visibility' = 'public'
            AND jsonb_typeof(item.entry -> 'value') = 'string'
        ),
        '[]'::jsonb
      ),
    'chosenFamilyLabels',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'visibility', 'public',
              'value', item.entry -> 'value'
            )
            ORDER BY item.position
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(profiles.content -> 'chosenFamilyLabels') = 'array'
                THEN profiles.content -> 'chosenFamilyLabels'
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS item(entry, position)
          WHERE jsonb_typeof(item.entry) = 'object'
            AND item.entry ->> 'visibility' = 'public'
            AND jsonb_typeof(item.entry -> 'value') = 'string'
        ),
        '[]'::jsonb
      ),
    'links',
      CASE
        WHEN jsonb_typeof(profiles.content -> 'links') = 'array'
          THEN profiles.content -> 'links'
        ELSE '[]'::jsonb
      END
  )
  || CASE
       WHEN jsonb_typeof(profiles.content -> 'avatar') = 'object'
         THEN jsonb_build_object('avatar', profiles.content -> 'avatar')
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN jsonb_typeof(profiles.content -> 'banner') = 'object'
         THEN jsonb_build_object('banner', profiles.content -> 'banner')
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN jsonb_typeof(profiles.content -> 'website') = 'string'
         THEN jsonb_build_object('website', profiles.content -> 'website')
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN jsonb_typeof(profiles.content -> 'gender') = 'object'
         AND profiles.content -> 'gender' ->> 'visibility' = 'public'
         AND jsonb_typeof(profiles.content -> 'gender' -> 'value') = 'string'
         THEN jsonb_build_object(
           'gender',
           jsonb_build_object(
             'visibility', 'public',
             'value', profiles.content -> 'gender' -> 'value'
           )
         )
       WHEN jsonb_typeof(profiles.content -> 'gender') = 'string'
         AND profiles.content ->> 'genderVisibility' = 'public'
         THEN jsonb_build_object(
           'gender',
           jsonb_build_object(
             'visibility', 'public',
             'value', profiles.content -> 'gender'
           )
         )
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN jsonb_typeof(profiles.content -> 'location') = 'object'
         AND profiles.content -> 'location' ->> 'visibility' = 'public'
         AND jsonb_typeof(profiles.content -> 'location' -> 'value') = 'string'
         THEN jsonb_build_object(
           'location',
           jsonb_build_object(
             'visibility', 'public',
             'value', profiles.content -> 'location' -> 'value'
           )
         )
       ELSE '{}'::jsonb
     END;

-- The compatibility column remains in the current projection schema, so it
-- must be sanitized too. Otherwise an upgraded database could retain protected
-- legacy plaintext even though all application reads use the new public
-- `content` projection.
UPDATE profiles
SET pronouns = content -> 'pronouns';

ALTER TABLE profiles
  ALTER COLUMN content SET NOT NULL;
