DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_key_bundles
    WHERE key_kind = 'solana-ed25519-root-seed'
    GROUP BY credential_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one root wrapper per credential while duplicate root wrappers exist'
      USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS auth_one_root_bundle_per_credential
  ON auth_key_bundles (credential_id)
  WHERE key_kind = 'solana-ed25519-root-seed';
