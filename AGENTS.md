# AGENTS.md

Guidance for AI coding agents working in this repository. Keep this file and
`CLAUDE.md` in sync — they carry the same content for different tools.

## What this repository is

**WokeSocial** is an open, pre-release social platform; **WokeNet** is its
portable protocol and Anchor smart-contract layer on **Solana**. This is a
pnpm-plus-Turborepo monorepo containing one Anchor program, eight TypeScript
apps, ten shared packages, local Docker infrastructure, and heavyweight
verification tooling.

Terminology is machine-enforced (`pnpm naming:check`):

- **WokeSocial** = the product, flagship web app, services, native clients.
- **WokeNet** = the protocol/program layer and deployment metadata. It is
  **not** a blockchain, Solana fork, validator network, or RPC network.
- **Solana** = the chain. Validators and RPC providers are external.
- `woke.social` = canonical origin. The legacy hostname (see
  `docs/DECISIONS/0008-canonical-domain-transition.md`) is redirect-only and
  never an application or WebAuthn origin. `pnpm domain:check` forbids even
  naming the legacy domain outside an explicit allow-list.
- **`$WOKE` does not exist.** Never call SOL or lamports `$WOKE`. The legacy
  lamport payment ABI is quarantined and must remain fail-closed.
- The local checkout directory must be named `wokenet` (naming check enforces
  this too).

**Honest status is a core value here.** The repo is pre-release: no devnet or
mainnet-beta deployment, no `$WOKE` mint, no released mobile app.
[TASKS.md](TASKS.md) and [FINAL_REPORT.md](FINAL_REPORT.md) record the exact
verification boundary. Never present a locally verified subset as
production-ready, never turn a skipped/mocked gate into a success claim, and
label local-validator evidence as local.

## Toolchain (exact pins — do not substitute)

| Tool                               | Version                       | Notes                                                               |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| Node.js                            | `22.23.1`                     | `scripts/preflight.mjs` hard-fails on any other version             |
| pnpm                               | `11.2.2`                      | via Corepack; `engineStrict`                                        |
| Rust (host)                        | `1.89.0`                      | project-local under `.local/toolchains/`, installed by `pnpm setup` |
| Solana (Agave)                     | `2.3.0`                       | project-local; program MSRV is 1.84.0 (SBF compiler constraint)     |
| Anchor                             | `0.32.1`                      | project-local                                                       |
| PostgreSQL / Redis / Kubo / ClamAV | 18.4 / 8.8.1 / 0.42.0 / 1.5.3 | digest-pinned containers in `infra/compose.yaml`                    |

External dependencies use **exact versions**; internal packages use
`workspace:` references; every manifest needs `"license": "MIT"` — all
enforced by `pnpm workspace:check`.

## Setup and everyday commands

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup        # validates toolchain, installs .local/toolchains, starts containers, env:check, migrations
pnpm dev          # starts infra + all implemented dev processes (media worker runs in Docker)
```

| Command                                                    | Purpose                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev:check`                                           | Print the resolved dev plan as JSON without starting anything |
| `pnpm infra:up` / `infra:down` / `infra:ps` / `infra:logs` | Manage local containers (`down` preserves volumes)            |
| `pnpm env:check`                                           | Validate typed environment via `packages/config`              |
| `pnpm format:check` / `pnpm format`                        | Prettier                                                      |
| `pnpm lint` / `lint:fix`                                   | ESLint, `--max-warnings 0`                                    |
| `pnpm typecheck`                                           | Strict tsc across workspaces (turbo)                          |
| `pnpm build`                                               | Build all workspaces (turbo)                                  |
| `pnpm verify`                                              | The standard quality gate (see below)                         |
| `pnpm toolchain:install`                                   | (Re)install checksum-verified Rust/Solana/Anchor              |

`.env.example` contains intentionally public local-only defaults. Copy to
`.env` only when you need overrides; never commit `.env` or real credentials.

## Test commands

Test layers are **intentionally separate** — a passing unit suite says nothing
about containers, browsers, the local validator, or the connected slice.

| Command                                    | What it runs                                                                                                                | Needs                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm test`                                | Fast workspace unit suites (vitest) + `node --test scripts/tests/*.test.mjs`                                                | built deps (turbo handles it)                   |
| `pnpm test:integration`                    | Every workspace `test:integration` (PostgreSQL, Redis, Kubo, real sockets)                                                  | `pnpm infra:up` + provisioned roles             |
| `pnpm test:e2e`                            | Playwright browser suites (web)                                                                                             | `pnpm test:e2e:install` once                    |
| `pnpm test:programs`                       | Anchor SBF build + mocha suite in `tests/programs/**` on a local validator                                                  | `pnpm setup` (toolchain); validator auto-starts |
| `pnpm test:vertical-slice`                 | Full validator → CAS → indexer → PostgreSQL → production web → real Chromium passkey publication → destructive replay proof | Docker + toolchain; expensive                   |
| `pnpm test:vertical-slice:preflight`       | Cheap syntax/artifact check of the slice harness                                                                            | —                                               |
| `pnpm measure:performance`                 | Loopback production-web performance samples                                                                                 | built web                                       |
| `pnpm security:audit` / `security:secrets` | `pnpm audit` / checksum-pinned gitleaks                                                                                     | —                                               |

Composite gates:

- `pnpm verify` = `workspace:check` + `naming:check` + `domain:check` +
  `format:check` + `lint` + `typecheck` + `test` + `build` + `domain:probe`.
  This is what CI's quality job runs; run it before requesting review.
- `pnpm verify:all` = `verify` + integration + e2e + performance + programs +
  vertical slice + audit + secret scan. Expensive; needs local services.

### Running a single test

Unit tests are **vitest 4** everywhere (exception: on-chain program tests are
**mocha**, and web browser tests are **Playwright**).

```sh
# one file (fastest loop)
pnpm --filter @wokesocial/protocol exec vitest run test/signatures.test.ts

# one case
pnpm --filter @wokesocial/indexer exec vitest run test/indexer.test.ts -t "substring"

# one package's full suite (includes extras like protocol's schema:check)
pnpm --filter @wokesocial/protocol test

# integration file (serial; needs infra up)
pnpm --filter @wokesocial/indexer exec vitest run --no-file-parallelism test/handles.integration.test.ts

# web unit vs. browser
pnpm --filter @wokesocial/web exec vitest run tests/indexer.test.ts
pnpm --filter @wokesocial/web exec playwright test e2e/smoke.spec.ts --project chromium
```

Gotchas:

- **Build dependencies first.** Workspace packages resolve through their
  `dist/` exports and turbo's `test` depends on `^build`. Bypassing turbo with
  `exec vitest` requires a prior `pnpm build` (at least of the dependency
  chain, e.g. protocol → storage → sdk).
- Backend app/package `test` scripts pass `--exclude 'dist/**'` (and exclude
  `*.integration.test.ts`); replicate those excludes if you invoke vitest with
  custom globs.
- Integration DB URLs resolve as `<SERVICE>_INTEGRATION_DATABASE_URL` →
  `DATABASE_URL` → local default.
- `packages/protocol`'s `test` script runs `schema:check` first (generated
  JSON Schema drift). After changing protocol schemas, run
  `pnpm --filter @wokesocial/protocol schema:generate`.
- `apps/web` has three Playwright configs: default (`e2e/`),
  `vertical-slice.playwright.config.ts`, and
  `publication-slice.playwright.config.ts` (the latter two require env-provided
  loopback URLs and are driven by the vertical-slice harness).
- `apps/auth-service`'s "e2e" is vitest driving Playwright's chromium via CDP
  virtual authenticators (`test/browser.e2e.test.ts`), not `playwright test`.
- Rust unit tests (`programs/social_protocol/src/unit_tests.rs`) have no pnpm
  wrapper; run `cargo test` manually with the project-local toolchain if you
  touch program internals (frozen discriminators, account sizing, payment
  quarantine live there).

## Repository layout and service map

```text
apps/         eight applications (see table)
packages/     ten shared TypeScript libraries
programs/social_protocol   the WokeNet Anchor program
tests/programs              mocha local-validator program suite
tests/vertical-slice        connected-slice seed/replay/evidence modules
scripts/      setup, verification, and orchestration (incl. vertical-slice/run.mjs)
network/solana   deployment-manifest schema + example (localnet only today)
infra/        Docker Compose (digest-pinned, loopback-only, hardened)
docs/         architecture, protocol, testing, security docs + docs/DECISIONS ADRs
```

All service ports bind `127.0.0.1` by default:

| App                       | Package                          | Port | Stack / role                                                                                               |
| ------------------------- | -------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `apps/web`                | `@wokesocial/web`                | 3000 | Next.js 16 App Router flagship client (~45 routes); no Dockerfile                                          |
| `apps/indexer`            | `@wokesocial/indexer`            | 4000 | Fastify + PostgreSQL projection of finalized program events; 18 ordered migrations; `@solana/kit` RPC sync |
| `apps/feed-service`       | `@wokesocial/feed-service`       | 4100 | Stateless deterministic feed ranking; every response `canonical: false`                                    |
| `apps/relay`              | `@wokesocial/relay`              | 4200 | Raw `node:http` + `ws` advisory transport; locked-by-default; no DB; single replica only                   |
| `apps/auth-service`       | `@wokesocial/auth-service`       | 4300 | WebAuthn/passkey RP + ciphertext-only key-bundle sync; 5 migrations                                        |
| `apps/moderation-service` | `@wokesocial/moderation-service` | 4400 | Signed labels/reports/appeals; append-only encrypted case ledger; 3 migrations; locked-by-default          |
| `apps/media-worker`       | `@wokesocial/media-worker`       | 4500 | Resumable uploads, Sharp/FFmpeg processing, real ClamAV (clamd on private network, port 3310)              |
| `apps/mobile`             | `@wokesocial/mobile`             | —    | Non-release Expo/React Native Android (Solana Seeker, Mobile Wallet Adapter); read-only                    |

Packages and their dependency graph (`protocol` is the root; leaves have no
workspace deps):

| Package                   | Role                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`       | **Single source of truth** for the 29 portable object families: strict Zod schemas, RFC 8785 canonicalization, SHA-256 object IDs / CIDv1 content IDs, Ed25519 domain-separated signatures, authorization + transition rules, `.woke` name derivation, generated JSON Schema |
| `packages/storage`        | Content-addressed storage adapters: local CAS, memory, IPFS/Kubo, consent-gated Arweave, multi-provider quorum/failover (→ protocol)                                                                                                                                         |
| `packages/sdk`            | Publication pipeline (validate→sign→store→anchor→confirm, recoverable receipts, reconcile-before-init), Anchor instruction builders/decoders, strict simulate/broadcast/finalize transaction boundary, provider pools. Never accepts private keys (→ protocol, storage)      |
| `packages/indexer-client` | Runtime-neutral, strictly validated read client for the indexer API (6 MiB response budget) (→ protocol)                                                                                                                                                                     |
| `packages/config`         | Typed env validation (Zod), fail-closed production gates, TLS/proxy/rate-limit/migration-integrity policy. Retired `WOKENET_*` env keys fail closed — use `SOLANA_*`                                                                                                         |
| `packages/crypto`         | Dependency-free WebCrypto: domain-separated SHA-256/HKDF, AES-256-GCM sealed envelopes, passkey-PRF key wrapping. No signatures here — those live in protocol                                                                                                                |
| `packages/rate-limit`     | Fail-closed Redis fixed-window limiting (HMAC-digested keys, atomic Lua); explicit loopback-only memory mode; no Redis→memory fallback                                                                                                                                       |
| `packages/messaging`      | Pairwise-only E2EE adapter over pinned Matrix Rust crypto WASM; volatile storage only; currently consumed by nothing                                                                                                                                                         |
| `packages/test-fixtures`  | Deterministic public test keys and signed manifests (never production secrets)                                                                                                                                                                                               |
| `packages/ui`             | Presentational React primitives + design tokens; exports source (no build, no tests)                                                                                                                                                                                         |

## Big-picture architecture

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before structural work;
[docs/PROTOCOL.md](docs/PROTOCOL.md) and [docs/DECISIONS/](docs/DECISIONS/)
before protocol/program work.

**Authority model — four state classes that must never be conflated:**

1. **Verifiable protocol state** — identity roots, delegations, handle claims,
   follow edges, community authority, post references, tombstones. Authority:
   the WokeNet Anchor program + finalized Solana history. Rebuildable.
2. **Signed portable objects** — profile/post/community/etc. manifests.
   Authority: valid Ed25519 signatures + authorized key state + content hashes.
   Immutable once published; edits create new revisions with
   `replacement.sequence` lineage.
3. **Derived projections** — PostgreSQL/Redis. **Never authoritative, always
   disposable and deterministically rebuildable.**
4. **Private/ephemeral service state** — encrypted envelopes, moderation
   evidence, rate limits. Minimized, retention-bounded, never onchain.

**Data flow:** clients canonicalize + sign manifests → publish bytes to
content-addressed storage → anchor `(manifest_hash, manifest_uri)` references
through the Anchor program → the indexer ingests **finalized** events, fetches
and verifies bytes (CID, hash, signature, key authorization), and projects
queryable state → feed/moderation/relay providers are replaceable conveniences
layered on top. Clients verify; hosted services are never trusted by position.

**The Anchor program** (`programs/social_protocol`, fixed dev program ID
`9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD`): 43 instructions, 19 account
layouts, 33 events, 130 errors. Patterns that matter when editing:

- `lib.rs` is thin dispatch; logic lives in `src/instructions/<name>.rs`;
  shared checks in `src/validation.rs`; PDA seeds/bounds in `src/constants.rs`.
- Every PDA is namespaced `[b"wokesocial", [1], <domain seed>, ...]`.
- Optimistic concurrency: instructions take `expected_*_sequence` args and
  reject stale writes; all arithmetic is checked.
- Social/membership edge PDAs are **reused, never closed** (an `active` flag +
  `state_sequence` bump) so replay stays deterministic.
- Delegation scopes are four closed bits (profile/post/social/community);
  `authorize_identity_action` is the single authorization choke point, and
  delegations die on root rotation (epoch check).
- Instruction/event/account discriminators are **frozen by unit tests** —
  ABI drift is a test failure, not a refactor.
- The payment instruction family is deliberately dead code
  (`LEGACY_LAMPORT_PAYMENT_ABI_ENABLED = false`); its tests prove it cannot
  execute, mutate authority, or be unpaused. Do not "fix" this.

**Common service shape** (auth, feed, indexer, media, moderation; relay
structurally similar): `src/server.ts` (bootstrap, signal handling, scrubs
rate-limit secrets from `process.env` after wiring) → `src/app.ts` (Fastify
with redacted logging, strict CORS, fail-closed shared rate limiting, security
headers) → `src/service.ts` → `src/store.ts` interface with swappable
adapters (`memory-*` for dev/tests, `postgres-*` for real, moderation adds a
`locked` store that throws — the production default until authorizers are
injected). Uniform surface: `/healthz`, `/readyz`, `/openapi.json`,
`/v1/policy`, versioned `/v1/*` routes. Dev scripts run through
`scripts/run-scoped-runtime.mjs`, which strips every credential except the one
DB URL that service is allowed to see.

**Migrations:** ordered SQL files per service (indexer 18, auth 5, moderation 3) with SHA-256 checksum ledgers and advisory locks. Migration and runtime use
**separate PostgreSQL roles**; long-running services are DML-only and refuse to
inherit migration credentials. Add a new ordered migration; never rewrite a
published one (predeployment resets are an explicit, documented decision).
Prove forward application _and_ projection rebuild.

**The vertical slice** (`pnpm test:vertical-slice`,
`scripts/vertical-slice/run.mjs`) is the flagship end-to-end proof: fresh local
validator + disposable PostgreSQL → seeded 11-transaction history → production
indexer + web build → real Chromium registers a passkey identity + `.woke`
name and publishes posts (including an ambiguous-response recovery without
rebroadcast) → the projection is destroyed and replayed to exact state. If your
change crosses program/storage/indexer/client boundaries, this gate is the
evidence.

## Engineering rules

- **TypeScript is strict everywhere** (`tsconfig.base.json`:
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). ESLint enforces inline `type` imports. Avoid `any`,
  unexplained lint suppression, swallowed errors, unbounded parsing/retries,
  and secrets or private content in logs.
- All workspace code is ESM. Services pair `tsconfig.json` (typecheck incl.
  tests) with `tsconfig.build.json` (emit to `dist/`).
- **New environment variables require typed validation in `packages/config`
  and a safe example in `.env.example`.** Production/shared config fails
  closed; local bypasses must be explicit, development-only, and loopback-only
  (the `*_DANGEROUSLY_*` pattern).
- **Fail-closed is a design invariant**, not a default to work around: locked
  stores, locked relay/moderation readiness, rate limiting that throws on
  backend failure rather than admitting traffic, quarantined payment ABI.
- Discuss before implementing (and record an ADR in `docs/DECISIONS/`) any
  change to: canonical bytes, signatures, object identifiers, schemas, PDA
  seeds, account layouts, instructions, events; identity/custody/recovery/
  delegation authority; public-private data placement, retention, deletion,
  encryption; DB or protocol migrations, provider contracts, public APIs;
  payments/tokens; Android permissions/signing/distribution.
- Protocol or program changes require synchronized Rust + TypeScript + IDL +
  indexer + SDK + fixture + documentation updates, adversarial tests (not just
  success paths), `pnpm test:programs`, and connected-slice evidence when the
  change crosses layer boundaries.
- Web UX: preserve loading/empty/partial/error/offline/stale/blocked/deleted/
  pending/degraded semantics; new interactive flows need keyboard behavior,
  visible focus, reduced motion, and accessible names. A success UI must
  reflect verified state, never a merely-submitted operation.
- Use conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `build:`, `chore:`).
- PRs list exact commands and results, including intentional skips and
  unverified behavior.

## Things that will bite you

- `pnpm setup` / `pnpm dev` refuse non-development environments and
  non-loopback binds; `pnpm dev` scrubs DB passwords from the environment
  before starting turbo.
- Turbo `typecheck` depends on `build` — a broken build fails typecheck.
- `pnpm domain:probe` (last step of `verify`) needs the production web build
  present (`apps/web/.next/BUILD_ID`).
- Program keypairs are deterministic: `scripts/prepare-local-solana.mjs` writes
  `target/deploy/social_protocol-keypair.json` and `.local/solana/deployer.json`
  and hard-fails if the program keypair doesn't match the declared ID.
- `network/wokenet/` contains only empty leftover directories from the
  abandoned own-chain era; `network/solana/` (manifest schema + example) is the
  live part.
- Relay keeps replay/connection state in-process — never scale it to multiple
  replicas as a "fix".
- `pnpm infra:down` preserves named volumes. Do not improvise destructive
  Docker or database commands; data deletion has explicit procedures
  (see docs/OPERATIONS.md).
- pnpm is hardened: `minimumReleaseAge` 24h quarantine, `allowBuilds`
  allow-list, exact `overrides` with explanatory comments. Adding or bumping a
  dependency may require touching `pnpm-workspace.yaml` deliberately — keep
  exceptions exact and commented.

## Key documentation

| Topic                                                 | Where                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Big-picture architecture, trust boundaries, authority | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                                                                                     |
| Portable object/signature/protocol spec               | [docs/PROTOCOL.md](docs/PROTOCOL.md), [packages/protocol/README.md](packages/protocol/README.md)                                                                 |
| Decision records (12 ADRs)                            | [docs/DECISIONS/](docs/DECISIONS/)                                                                                                                               |
| Contributor workflow, review checklist                | [CONTRIBUTING.md](CONTRIBUTING.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)                                                                                   |
| Test layers and evidence expectations                 | [docs/TESTING.md](docs/TESTING.md)                                                                                                                               |
| Verified status boundary                              | [TASKS.md](TASKS.md), [FINAL_REPORT.md](FINAL_REPORT.md)                                                                                                         |
| Security / threat model / privacy / moderation        | [docs/SECURITY.md](docs/SECURITY.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/PRIVACY.md](docs/PRIVACY.md), [docs/MODERATION.md](docs/MODERATION.md) |
| Local infra and operations                            | [infra/README.md](infra/README.md), [docs/OPERATIONS.md](docs/OPERATIONS.md)                                                                                     |
