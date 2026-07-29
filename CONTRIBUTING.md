# Contributing to WokeSocial

Thank you for helping build an inclusive, user-owned social network. Contributions are
welcome from people of every identity and experience level. Participation is governed by
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Before you begin

- Read the architecture, protocol, privacy, moderation, and security documentation.
- Do not include private keys, seed phrases, credentials, private user content, or real
  personal data in issues, fixtures, commits, or logs.
- Report suspected vulnerabilities through [SECURITY.md](./SECURITY.md), not a public issue.
- Discuss protocol compatibility or trust-boundary changes before implementation and record
  accepted decisions as ADRs.

## Required toolchain

The repository pins Node 22.23.1, pnpm 11.2.2, Rust, Anchor, and the Solana
toolchain used to build and test WokeNet programs. Do not silently substitute
newer versions. The non-release Seeker Android foundation must likewise keep its
Android, Kotlin, Expo/React Native, native-module, and Mobile Wallet Adapter
versions pinned.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup` validates the toolchain and typed environment, then starts the local PostgreSQL,
Redis, and Kubo/IPFS services. Copy `.env.example` to `.env` only when local overrides are
needed.

## Repository conventions

- Applications live in `apps/*`; shared TypeScript packages live in `packages/*`.
- WokeNet programs use the Rust and Anchor workspace rather than pnpm
  workspaces. The disposable Solana local validator provides local development
  evidence; public claims require a recorded Solana cluster and program
  deployment.
- Shared protocol schemas are defined once and imported by clients and services.
- PostgreSQL is a replayable projection, and Redis is disposable coordination.
- External dependencies use exact versions. Internal packages use `workspace:` references.
- TypeScript is strict. Avoid `any`, unexplained lint suppressions, swallowed errors, and
  unsafe logging.
- New environment variables require schema validation in `packages/config` and a safe
  placeholder in `.env.example`.

## Quality gates

Run the relevant checks before requesting review:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm test:e2e` for responsive-web browser flows and
`pnpm test:programs` for the Anchor program suite against the disposable Solana
local validator. These commands fail if no workspace or toolchain implements
the requested gate; an empty test stage is not reported as success.

The Seeker Android foundation is a separate release artifact. Changes to it
require its focused lint/type/test/build checks. A release additionally requires
Mobile Wallet Adapter intent/device tests, an installable reproducible signed
APK, recorded signing provenance, secure update/rollback evidence, and explicit
distribution approval.

For local infrastructure:

```sh
pnpm infra:config
pnpm infra:up
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
```

`infra:down` preserves named volumes. Delete local data only through a separately reviewed,
explicit procedure.

## Changes and review

- Keep pull requests focused and explain user, protocol, privacy, security, and
  decentralization impact.
- Include tests that fail before and pass after a behavior change.
- Update generated clients and documentation when a versioned schema or instruction changes.
- Include reproducible manual verification only when automation is not practical.
- Use conventional commit subjects such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `build:`, or `chore:`.
- Do not mark work complete while a required gate is skipped or unverified.

By contributing, you agree that your contribution is licensed under the repository's
Apache-2.0 license.
