ALTER TABLE auth_credentials
  DROP CONSTRAINT IF EXISTS auth_credentials_counter_check;

ALTER TABLE auth_credentials
  ADD CONSTRAINT auth_credentials_counter_range
    CHECK (counter >= 0 AND counter <= 4294967295),
  ADD CONSTRAINT auth_credentials_id_shape
    CHECK (
      credential_id ~ '^[A-Za-z0-9_-]+$'
      AND char_length(credential_id) <= 1368
    ),
  ADD CONSTRAINT auth_credentials_account_credential_unique
    UNIQUE (account_id, credential_id);

ALTER TABLE auth_key_bundles
  ADD CONSTRAINT auth_key_bundles_account_credential_fkey
    FOREIGN KEY (account_id, credential_id)
    REFERENCES auth_credentials(account_id, credential_id)
    ON DELETE CASCADE;
