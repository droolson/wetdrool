CREATE INDEX IF NOT EXISTS auth_pending_accounts_cleanup
  ON auth_accounts (created_at, account_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS auth_ceremonies_consumed_cleanup
  ON auth_ceremonies (consumed_at, ceremony_id)
  WHERE consumed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_expired_cleanup
  ON auth_sessions (expires_at, session_id);

CREATE INDEX IF NOT EXISTS auth_sessions_revoked_cleanup
  ON auth_sessions (revoked_at, session_id)
  WHERE revoked_at IS NOT NULL;
