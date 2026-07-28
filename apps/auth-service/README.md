# Replaceable passkey authentication service

This service implements the relying-party side of user-verifying, discoverable WebAuthn
credentials. It creates opaque account IDs, never asks for email or on-chain identity data, and
issues short-lived host-only sessions after exact-origin and exact-RP verification.

The service is deliberately not a Socially Woke identity or wallet:

- WebAuthn authenticates access to this replaceable service only.
- Woke Network transaction and portable-object signing keys remain client-side.
- Serialized `solana-ed25519-*` bundle kinds remain compatibility identifiers
  for Solana-compatible Ed25519 wire roles; they do not identify the network.
- WebAuthn PRF results, plaintext Ed25519 seeds, and private keys are rejected before request
  handling and redacted from logs.
- Only validated `@socially-woke/crypto` ciphertext bundles can be synchronized.
- Email recovery and last-credential revocation are disabled until a reviewed recovery protocol
  exists.

## Security model

All state-changing routes require the exact configured `Origin`, a server-issued double-submit
CSRF token, and Strict host-only cookies. Authenticated mutations additionally bind the CSRF token
to the server-side session. Session secrets are random, stored only as hashes, rotated after
step-up, and revocable. Registration and authentication challenges are random, purpose/account
bound, expire after five minutes, and are atomically consumed before verification with one
permitted attempt.

Credential metadata includes the COSE public key, counter, transports, device type, backup state,
last-use time, and revocation time. Counters advance monotonically, while backup-state changes from
verified assertions are preserved. Adding or revoking credentials requires a fresh user-verifying
step-up. Credential revocation atomically deletes the corresponding synchronized wrappers and
revokes every service session for the account, but does not pretend to revoke an on-chain
delegation.

The in-memory store identifies itself as `memory-development-only`. Server startup requires
`AUTH_DATABASE_URL` unless `AUTH_DANGEROUSLY_USE_MEMORY_STORE=1` is explicitly configured.
Production configuration uses RP ID `woke.social` and exact origin `https://woke.social`.
`sociallywoke.com` is redirect-only and must not be added as a second WebAuthn origin.

## Configuration

- `AUTH_RP_ID` — exact WebAuthn relying-party ID
- `AUTH_ORIGIN` — exact credential-free HTTPS origin (`http://localhost` is allowed locally)
- `AUTH_RP_NAME` — user-visible relying-party name
- `AUTH_DATABASE_URL` — durable PostgreSQL URL
- `AUTH_HOST` / `AUTH_PORT` — listener, default `127.0.0.1:4300`
- `AUTH_DANGEROUSLY_USE_MEMORY_STORE=1` — explicit local-only fallback
- `AUTH_CLEANUP_INTERVAL_MS` / `AUTH_CLEANUP_BATCH_SIZE` — bounded, nonoverlapping cleanup cadence
- `AUTH_PENDING_ACCOUNT_RETENTION_MS` — abandoned provisional-account retention, minimum five minutes
- `AUTH_CEREMONY_RETENTION_MS` / `AUTH_SESSION_RETENTION_MS` — stale challenge/session retention

The OpenAPI description is available from `GET /openapi.json`; explicit custody and recovery
capabilities are available from `GET /v1/policy`.

## Verification

From the repository root:

```sh
pnpm --filter @socially-woke/auth-service typecheck
pnpm --filter @socially-woke/auth-service lint
pnpm --filter @socially-woke/auth-service test
pnpm --filter @socially-woke/auth-service test:integration
pnpm --filter @socially-woke/auth-service test:e2e
pnpm --filter @socially-woke/auth-service build
docker build --file apps/auth-service/Dockerfile --tag socially-woke-auth-service:local .
```

The integration suite uses `AUTH_INTEGRATION_DATABASE_URL`, then `DATABASE_URL`, then the
repository's local PostgreSQL default. The browser suite needs the Playwright Chromium binary
(`pnpm exec playwright install chromium` once per development environment) and exercises real
WebAuthn verification through Chromium's virtual authenticator on port 4300.

## Known operational limitations

Recovery remains unsupported, so the last active passkey cannot be revoked. The server performs
indexed, bounded cleanup of abandoned provisional accounts and stale ceremonies/sessions using
explicit retention windows. This is deletion maintenance, not a security audit log; a production
operator still needs approved audit-event retention, backup/restore evidence, capacity testing,
alerts, and privacy review.

The OCI image is verified locally as an unprivileged numeric user with a read-only root
filesystem, dropped Linux capabilities, bounded process count, and separate liveness/readiness
probes. That narrow evidence does not claim a signed image, SBOM, production TLS, secret
injection, multi-region deployment, or recovery readiness.
