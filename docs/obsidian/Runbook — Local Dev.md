---
tags: [wetdrool, runbook, dev]
updated: 2026-08-04
---

# Runbook — local dev

Toolchain pins: Node `22.23.1`, pnpm `11.2.2` (see root `AGENTS.md`).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup          # infra + toolchains when needed
pnpm --filter @wetdrool/web dev
# http://127.0.0.1:3000 → /hub
```

## Product-focused loops

```sh
# unit
cd apps/web && ./node_modules/.bin/vitest run tests/short-feed.test.ts

# web only
pnpm --filter @wetdrool/web typecheck
pnpm --filter @wetdrool/web test
```

## Services (optional for full slice)

Indexer :4000, auth :4300, etc. — `pnpm dev` plan via `pnpm dev:check`.

## Related

- [[Runbook — GitHub and Vercel Push]]
- `docs/DEVELOPMENT.md`
