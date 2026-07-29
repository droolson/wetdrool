# Local infrastructure

`compose.yaml` provides pinned local-development dependencies:

- PostgreSQL 18.4 for replayable service projections.
- Redis 8.8.1 for disposable cache, queues, rate limits, and coordination.
- Kubo 0.42.0 for the local IPFS-compatible storage adapter.

All host ports bind to `127.0.0.1`. Defaults come from the repository's `.env.example`; a
local ignored `.env` overrides them.

Forwarded client addresses are disabled unless `TRUSTED_PROXY_CIDRS` contains
the exact ingress IP/CIDR allowlist. In any nonlocal deployment, keep service
ports private to that ingress and configure the edge to replace, not preserve,
client-supplied `X-Forwarded-*` headers. Otherwise connection and request rate
limits intentionally share the transport peer's bucket.

```sh
pnpm infra:config
pnpm infra:up
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
```

`infra:up` waits for base-container health, runs the foreground
`postgres-provision` job, and then starts the selected long-running profiles.
The provisioner creates separate auth, indexer, and moderation schemas with
distinct migration and runtime roles. A clean, direct, no-profile
`docker compose up --detach --wait` still contains only long-running base
dependencies; the provisioner remains an explicit one-shot. `infra:down`
removes containers and the network but preserves named volumes. These
credentials and ports are development-only and are not a production deployment
design.

Provisioning refuses an older volume with application objects in `public`
before it creates parallel empty schemas. Follow the explicit preserve-or-reset
procedure in
[`docs/OPERATIONS.md`](../docs/OPERATIONS.md#legacy-public-schema-volume-upgrade-or-reset);
never bypass that check.

The root `pnpm dev` command selects the local environment file, starts the base
dependencies plus `--profile media`, applies local migrations, and then starts
the remaining workspace processes. Immediately before loose-mode Turbo starts,
it removes `POSTGRES_PASSWORD` and every environment key ending in
`DATABASE_MIGRATION_URL` or `DATABASE_MIGRATION_PASSWORD`, including
service-specific Compose overrides. This keeps ClamAV private to its bridge
while making the browser-facing media worker available on loopback.

That scrub reduces accidental credential inheritance; it does not turn a
shared developer shell, process table, `.env`, Docker daemon, or workstation
account into a production secret boundary. Nonlocal deployments must inject
each long-running service's runtime credentials separately and expose
migration/bootstrap credentials only to audited one-shot jobs.

Verified on 2026-07-28: `pnpm setup` brought all three services to healthy state and applied
the initial PostgreSQL projection migration. The indexer PostgreSQL integration and the Kubo
publish/retrieve/verify/unpin integration passed against these containers. This evidence does
not cover backup/restore, load, failover, or production hardening.

The Kubo API must never be exposed publicly. Production storage, database, and Redis services
require provider-specific private networking, authentication, secret injection, backups, and
least-privilege controls described in `docs/DEPLOYMENT.md`.

The optional `services` profile builds and runs the noncanonical authentication
and feed services. Compose first runs the advisory-locked
`auth-service-migrate` one-shot against the local PostgreSQL dependency and
starts authentication only after that job succeeds:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile services up --detach --build --wait auth-service
```

To start both:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile services up --detach --build --wait auth-service feed-service
```

Both images use a digest-pinned Node base, an unprivileged numeric user, a
read-only root filesystem, dropped Linux capabilities, bounded process count,
and distinct liveness/readiness probes. This is local deployment evidence, not
a production hosting claim; TLS termination, secret injection, backups,
capacity limits, image signing, SBOMs, and multi-provider deployment remain
outside this Compose profile.

`auth-service-migrate` receives only `AUTH_DATABASE_MIGRATION_URL`; the
long-running service receives only `AUTH_DATABASE_URL` and performs no DDL.
The local container URL defaults to the Compose PostgreSQL hostname and can be
overridden with `AUTH_COMPOSE_DATABASE_MIGRATION_URL`. Host-run `pnpm setup`
instead uses the loopback-only `AUTH_DATABASE_MIGRATION_URL` from the selected
local environment file. Migration ledgers contain exact packaged-SQL SHA-256
values, and runtime roles retain read-only ledger access.

The optional `indexer` profile packages the independently runnable PostgreSQL
projection service. Build it, start PostgreSQL, complete the one-shot migration,
and only then start the DML-only runtime:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile indexer build indexer-migrate indexer
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile indexer up --detach --wait postgres
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile indexer up indexer-migrate
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile indexer up --detach --wait indexer
curl --fail http://127.0.0.1:4000/readyz
```

Its image runs as numeric UID/GID `10005`, uses a read-only root filesystem,
publishes only the loopback HTTP port, and mounts the durable `indexer-content`
volume read-only at `/var/lib/wokesocial/content`. The separate
`indexer-migrate` service receives `DATABASE_MIGRATION_URL`; the runtime receives
only `DATABASE_URL`. The migration command also takes a PostgreSQL advisory lock
to serialize accidental concurrent jobs.

Compose passes explicit batch, deployment-slot, poll, retry, and staleness
settings. `INDEXER_SOLANA_RPC_URLS` defaults to
`http://host.docker.internal:8899`, with a `host-gateway` mapping, rather than
the container-local and unreachable `127.0.0.1`. Override it with one or more
comma-separated container-reachable RPC URLs whenever
`INDEXER_NETWORK_ID` enables synchronization. Readiness stays `503` until the
first successful finalized poll and becomes unavailable when successful polls
are older than `INDEXER_SYNC_STALE_AFTER_MS`.

The image itself defaults `APP_ENV=production` and `NODE_ENV=production`;
this local Compose profile explicitly overrides both to development. A
production deployment must explicitly supply both modes plus the complete
nonlocal production configuration.

A rebuild dry run and its explicitly confirmed apply mode are documented in
[`apps/indexer/README.md`](../apps/indexer/README.md#rebuild-safety); the mounted
content volume must accompany the durable event ledger because referenced
manifests are reverified during replay.

The relay and moderation images are buildable under the separate
`locked-services` profile. Compose runs `moderation-service-migrate` to
completion before starting moderation. The long-running moderation container
receives a scoped runtime database role and a conspicuous local-only data key,
but still deliberately starts with liveness available and readiness returning
`503` because this standalone composition supplies no finalized-state
key/provider authorizer:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile locked-services up --detach --build --wait relay moderation-service
curl --fail http://127.0.0.1:4200/healthz
curl --fail http://127.0.0.1:4400/healthz
```

Do not set either `DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE` switch to `1` in a
shared or production environment. A healthy locked container is not a ready
service; verify `/readyz` independently.

`moderation-service-migrate` receives only
`MODERATION_DATABASE_MIGRATION_URL`; the runtime receives
`MODERATION_DATABASE_URL` for its own schema but neither that DDL credential nor
implicit schema mutation authority. Override the Compose-local migration URL
with `MODERATION_COMPOSE_DATABASE_MIGRATION_URL`. Host-run setup uses the
loopback-only `MODERATION_DATABASE_MIGRATION_URL` instead.

To rebuild all three images, run their migrations, and exercise runtime DML,
DDL denial, cross-schema denial, extension placement, and migration-ledger
write denial, use the explicit foreground probe:

```sh
node scripts/infra.mjs up --profile privilege-probe
```

The script does not route the one-shot probe through the final detached
`compose up --wait`; it runs provisioning, each migrator, and the probe in
order, then returns to the long-running base stack.

To connect the relay to an independently operated finalized-state authorizer,
set `RELAY_KEY_AUTHORIZER_URL` and, when needed,
`RELAY_KEY_AUTHORIZER_READINESS_URL`,
`RELAY_KEY_AUTHORIZER_BEARER_TOKEN`, and
`RELAY_KEY_AUTHORIZER_TIMEOUT_MS`. The shipped adapter rejects stale,
non-finalized, wrong-network, redirected, oversized, or timed-out decisions.
Configure `RELAY_SUBSCRIPTION_AUTHORIZER_URL` plus its matching optional
`_READINESS_URL`, `_BEARER_TOKEN`, and `_TIMEOUT_MS` variables for finalized
opaque-topic policy and community-membership decisions. Its short-lived grants
are rechecked for community delivery, and both configured dependencies gate
relay readiness. Production authorizer endpoints must use HTTPS.

The `media` profile builds the noncustodial media worker and its digest-pinned
ClamAV 1.5.3 scanner:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile media up --detach --build --wait clamav media-worker
curl --fail http://127.0.0.1:4500/readyz
```

ClamAV TCP port 3310 is never published to the host. Only the worker and daemon
join the dedicated `media-private` bridge. Both run as UID/GID 1000 with
read-only root filesystems, dropped capabilities, bounded process counts, and
private writable mounts. The daemon persists its signed database updates in
`clamav-data`; worker staging, temporary output, and local content-addressed
storage use separate named volumes.

The derived ClamAV image makes the worker's 100,000,000-byte contract real at
the daemon boundary by setting `StreamMaxLength` and `MaxFileSize` to that
exact value, `MaxScanSize` to 400 MB, and `AlertExceedsMax yes`. The public
all-zero token in `.env.example` is deliberately local-only. Generate a fresh
32–128-byte base64url token and inject it through a protected secret mechanism
for every shared environment. The packaged static-token adapter represents one
process-local operator, so it is not a multi-user or horizontally scalable
authorization design.
