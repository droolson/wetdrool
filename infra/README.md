# Local infrastructure

`compose.yaml` provides pinned local-development dependencies:

- PostgreSQL 18.4 for replayable service projections.
- Redis 8.8.1 for disposable cache, queues, rate limits, and coordination.
- Kubo 0.42.0 for the local IPFS-compatible storage adapter.

All host ports bind to `127.0.0.1`. Defaults come from the repository's `.env.example`; a
local ignored `.env` overrides them.

```sh
pnpm infra:config
pnpm infra:up
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
```

`infra:up` waits for container health. `infra:down` removes containers and the network but
preserves named volumes. These credentials and ports are development-only and are not a
production deployment design.

Verified on 2026-07-28: `pnpm setup` brought all three services to healthy state and applied
the initial PostgreSQL projection migration. The indexer PostgreSQL integration and the Kubo
publish/retrieve/verify/unpin integration passed against these containers. This evidence does
not cover backup/restore, load, failover, or production hardening.

The Kubo API must never be exposed publicly. Production storage, database, and Redis services
require provider-specific private networking, authentication, secret injection, backups, and
least-privilege controls described in `docs/DEPLOYMENT.md`.

The optional `services` profile builds and runs the noncanonical authentication
and feed services; authentication uses the local PostgreSQL dependency:

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

The relay and moderation images are buildable under the separate
`locked-services` profile. They deliberately start with liveness available and
readiness returning `503` because this standalone composition has no
finalized-state key/provider authorizer:

```sh
docker compose --env-file .env.example --file infra/compose.yaml \
  --profile locked-services up --detach --build --wait relay moderation-service
curl --fail http://127.0.0.1:4200/healthz
curl --fail http://127.0.0.1:4400/healthz
```

Do not set either `DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE` switch to `1` in a
shared or production environment. A healthy locked container is not a ready
service; verify `/readyz` independently.

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
