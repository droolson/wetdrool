ALTER TABLE auth_credentials
  DROP CONSTRAINT IF EXISTS auth_credentials_id_shape;

ALTER TABLE auth_credentials
  ADD CONSTRAINT auth_credentials_id_shape
    CHECK (
      credential_id ~ '^[A-Za-z0-9_-]+$'
      AND char_length(credential_id) <= 1364
    );
