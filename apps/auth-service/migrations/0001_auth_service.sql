CREATE TABLE IF NOT EXISTS auth_accounts (
  account_id text PRIMARY KEY CHECK (account_id ~ '^acct_[A-Za-z0-9_-]{22}$'),
  webauthn_user_handle bytea NOT NULL UNIQUE CHECK (octet_length(webauthn_user_handle) = 32),
  status text NOT NULL CHECK (status IN ('pending', 'active')),
  created_at timestamptz NOT NULL,
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_ceremonies (
  ceremony_id text PRIMARY KEY CHECK (ceremony_id ~ '^cer_[A-Za-z0-9_-]{22}$'),
  purpose text NOT NULL CHECK (
    purpose IN ('register-account', 'authenticate', 'step-up', 'add-credential')
  ),
  account_id text REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  challenge_hash bytea NOT NULL CHECK (octet_length(challenge_hash) = 32),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 3),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS auth_ceremonies_expiry
  ON auth_ceremonies (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_credentials (
  credential_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  public_key bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 1 AND 2048),
  counter numeric(20, 0) NOT NULL CHECK (
    counter >= 0 AND counter <= 18446744073709551615
  ),
  transports jsonb NOT NULL,
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK (device_type = 'multiDevice' OR NOT backed_up)
);

CREATE INDEX IF NOT EXISTS auth_active_credentials_by_account
  ON auth_credentials (account_id, created_at, credential_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^ses_[A-Za-z0-9_-]{22}$'),
  account_id text NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  secret_hash bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_authenticated_at timestamptz NOT NULL,
  step_up_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_by_account
  ON auth_sessions (account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_key_bundles (
  account_id text NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  credential_id text NOT NULL REFERENCES auth_credentials(credential_id) ON DELETE CASCADE,
  key_kind text NOT NULL CHECK (
    key_kind IN ('solana-ed25519-root-seed', 'solana-ed25519-delegation-seed')
  ),
  public_key text NOT NULL,
  bundle jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (credential_id, key_kind, public_key)
);

CREATE INDEX IF NOT EXISTS auth_key_bundles_by_account
  ON auth_key_bundles (account_id, key_kind, public_key, credential_id);
