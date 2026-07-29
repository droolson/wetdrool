# WokeSocial development guide

This guide gets a contributor from repository access to a review-ready change.
It complements the [contribution policy](../CONTRIBUTING.md) and
[testing strategy](TESTING.md).

## Current boundary

WokeSocial and WokeNet are pre-release. The repository contains substantial
locally verified work, but no production deployment is authorized or claimed:

- no WokeNet program is published to Solana devnet or mainnet-beta;
- no `$WOKE` mint or usable `$WOKE` payment flow exists;
- the legacy lamport payment ABI is quarantined and must remain fail-closed;
- the Solana Seeker Android project is a non-release foundation; and
- security, privacy, moderation, accessibility, legal, operations, and
  independent-review gates remain open.

Use [TASKS.md](../TASKS.md) and [FINAL_REPORT.md](../FINAL_REPORT.md) to
understand the verified boundary before changing status language.

## Access and collaboration

The GitHub repository, `AlexBTC420/wokesocial`, is currently private and
invite-only. People who already have a direct channel to
[@AlexBTC420](https://github.com/AlexBTC420) may request access there. A public
contributor-intake channel has not yet opened. After access is granted:

1. Read the [Code of Conduct](../CODE_OF_CONDUCT.md) and
   [security policy](../SECURITY.md).
2. Choose a bounded issue or agree on a small first contribution.
3. Discuss compatibility, authority, custody, privacy, permanence, or migration
   changes before implementation.
4. Keep one user or operator outcome per pull request.

Never post vulnerabilities, credentials, private keys, passkey material,
private user content, personal data, or production connection strings in
issues, pull requests, commits, screenshots, or logs.

## Required tools

| Tool    | Required version or state                         |
| ------- | ------------------------------------------------- |
| Node.js | `22.23.1` exactly                                 |
| pnpm    | `11.2.2` exactly, managed through Corepack        |
| Docker  | Running daemon with Docker Compose                |
| Git     | A maintained version suitable for the host        |
| Rust    | Project-local `1.89.0`, installed by `pnpm setup` |
| Solana  | Project-local `2.3.0`, installed by `pnpm setup`  |
| Anchor  | Project-local `0.32.1`, installed by `pnpm setup` |

The Solana SBF toolchain has its own embedded compiler constraints, which are
recorded in `Cargo.toml`. Do not replace pinned host, SBF, Android, Expo,
React Native, or Mobile Wallet Adapter versions as an incidental change.

## First setup

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup`:

1. validates Node, pnpm, Docker, and Docker Compose;
2. installs checksum-verified chain tooling under `.local/toolchains`;
3. starts the pinned local infrastructure;
4. validates the typed development environment; and
5. applies workspace setup and migration steps.

The checked-in `.env.example` contains local-only public defaults. Copy it to
`.env` only when overrides are necessary:

```sh
cp .env.example .env
```

Do not reuse its deterministic passwords, keys, or tokens in a shared
environment. Never commit `.env`.

Stop persistent local containers with:

```sh
pnpm infra:down
```

This preserves named volumes. Data deletion requires a separate, explicit
procedure; do not improvise destructive Docker or database commands.

## Repository map

```text
apps/
  web/                  Next.js flagship web application
  mobile/               Non-release Expo/React Native Seeker foundation
  auth-service/         WebAuthn relying party and ciphertext-only key-bundle sync
  indexer/              Finalized Solana synchronizer and PostgreSQL projection
  feed-service/         Replaceable feed and recommendation provider
  relay/                Non-authoritative signed WebSocket transport
  moderation-service/   Signed labels, reports, appeals, and restricted cases
  media-worker/         Authenticated media verification and processing
packages/
  protocol/             Canonical schemas, signatures, hashes, and identifiers
  sdk/                  Publication and WokeNet program client boundaries
  storage/              Content-addressed storage adapters
  indexer-client/       Runtime-neutral validated indexer client
  crypto/               WebCrypto and passkey key-wrapping primitives
  messaging/            Experimental pairwise Matrix crypto adapter
  rate-limit/           Shared fail-closed admission limiting
  config/               Typed environment and runtime contracts
  ui/                   Accessible shared UI foundations
programs/
  social_protocol/      WokeNet Anchor program
network/solana/         Deployment-manifest and cluster metadata
infra/                  Local provider-neutral infrastructure
scripts/                Setup, verification, operations, and evidence harnesses
docs/                   Product, protocol, safety, and operator documentation
```

## Everyday commands

| Command             | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `pnpm dev`          | Start the implemented local development processes               |
| `pnpm dev:check`    | Validate the development plan without starting it               |
| `pnpm format:check` | Check Prettier formatting                                       |
| `pnpm lint`         | Run workspace lint checks                                       |
| `pnpm typecheck`    | Run strict TypeScript checks                                    |
| `pnpm test`         | Run the fast workspace unit suite and script tests              |
| `pnpm build`        | Build implemented workspaces                                    |
| `pnpm verify`       | Run the normal repository quality gate                          |
| `pnpm verify:all`   | Run all available local gates, including expensive integrations |

Focused integration commands:

```sh
pnpm test:integration
pnpm test:e2e
pnpm test:programs
pnpm test:vertical-slice
pnpm measure:performance
```

These commands are intentionally separate. A passing unit suite does not imply
that containers, browsers, the Solana local validator, or the connected
protocol-to-web slice passed.

## Development workflows

### TypeScript application or package

Run the owning workspace's focused format, lint, type, and test scripts while
iterating. Before review, run the relevant root gates so cross-workspace
contracts are checked. Keep public parsers strict, inputs bounded, errors
stable, and logs free of secrets or private content.

### WokeNet program or protocol

Read [PROTOCOL.md](PROTOCOL.md) and the applicable
[ADRs](DECISIONS/) first. Changes to canonical bytes, schema versions,
identifiers, PDA seeds, accounts, instruction data, events, or authority
require:

- an explicit compatibility and migration analysis;
- synchronized Rust, TypeScript, IDL, indexer, SDK, fixture, and documentation
  updates;
- adversarial tests, not only success paths;
- `pnpm test:programs`; and
- connected-slice evidence when the change crosses program, storage, indexer,
  or client boundaries.

Local-validator evidence must be labeled local. Public deployment claims
require an exact Solana genesis hash, program ID, deployment slot, reviewed
artifact, and authority record.

### PostgreSQL schema or projection

Add an ordered migration; never rewrite an already-published migration without
an explicit predeployment reset decision. Keep runtime and migration roles
separate, make replay deterministic, and prove both forward application and
projection rebuild behavior. PostgreSQL is a disposable projection, not
canonical protocol state.

### Web experience

Preserve loading, empty, partial, error, offline, stale, sensitive, blocked,
deleted, revoked, pending, confirmed, and degraded-provider semantics where
applicable. New interactive flows need keyboard behavior, visible focus,
reduced-motion handling, responsive coverage, and accessible names and status
announcements. A success UI must correspond to verified state, not a mocked or
merely submitted operation.

### Solana Seeker Android

Treat the mobile project as a distinct native release surface. Responsive web
tests do not prove Android behavior. Wallet operations must preserve Mobile
Wallet Adapter's custody boundary, bind the exact network/program/instruction,
simulate before approval where specified, and verify finality. Do not claim a
release without device evidence, a reproducible signed APK, signing provenance,
update/rollback procedures, security review, and distribution approval.

### Documentation

Documentation changes should reduce ambiguity, preserve honest status
boundaries, and use relative links. Update [docs/README.md](README.md) when
adding a major document. An architecture decision belongs in an ADR when it
affects compatibility, authority, custody, privacy, permanence, provider
contracts, or migrations.

## Configuration rules

- New environment variables require schema validation in `packages/config` and
  a safe placeholder or commented example in `.env.example`.
- Production and shared environments must fail closed when required security,
  provider, origin, TLS, or authority configuration is missing.
- `woke.social` is the canonical origin. Legacy hostnames are redirect-only.
- Never commit embedded RPC credentials, provider tokens, session secrets,
  database secrets, wallet material, or passkey material.
- Local bypasses must be explicit, loopback-only, development-only, and
  impossible to enable in production.

## Review-ready checklist

Before requesting review:

- [ ] The change has one clear user, contributor, or operator outcome.
- [ ] Relevant specifications, ADRs, and status/evidence records are updated.
- [ ] Formatting, linting, type checks, and focused tests pass.
- [ ] Cross-workspace and production builds pass when affected.
- [ ] Integration, browser, program, and connected-slice gates run when their
      boundaries are affected.
- [ ] Privacy, security, moderation, accessibility, decentralization, and
      migration impacts are described.
- [ ] Failure, retry, rollback, or roll-forward behavior is explicit.
- [ ] No secret, private user content, personal data, or unsupported completion
      claim appears in the change.

Use conventional commit subjects such as `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, `build:`, or `chore:`. The pull request should list exact commands
and results, including skipped or unavailable gates.

## Getting unstuck

- Check [TESTING.md](TESTING.md) for the evidence expected at each layer.
- Check [OPERATIONS.md](OPERATIONS.md) for service readiness and local
  infrastructure behavior.
- Use `pnpm dev:check`, `pnpm infra:ps`, and `pnpm infra:logs` for safe
  diagnostics.
- Search existing private issues and ADRs before introducing a new pattern.
- Ask for a smaller, bounded task if a trust-boundary or compatibility change
  is unclear.

Contributors are expected to surface uncertainty. A precise limitation is more
valuable than an unsupported success claim.
