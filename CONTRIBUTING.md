# Contributing to Socially Woke

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

The repository pins Node 22.23.1, pnpm 11.2.2, Rust, Anchor, the
Solana-format compatibility toolchain, and the exact official Firedancer source
used for Woke Network. Do not silently substitute newer versions.

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
- Woke Network programs use the Solana-compatible Rust and Anchor workspace
  rather than pnpm workspaces; Agave/local-validator results are compatibility
  evidence only.
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

Use `pnpm test:e2e` for browser flows and `pnpm test:programs` for the
Anchor/Agave compatibility-oracle suite. Use `pnpm network:woke:check` for the
pinned native-Firedancer policy/source gate. These commands fail if no workspace
or toolchain implements the requested gate; an empty test stage is not reported
as success.

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
