---
tags: [wetdrool, runbook, github, vercel]
updated: 2026-08-04
---

# Runbook — GitHub and Vercel push

## Intent

Keep **mainline product** reproducible: every meaningful web/edge change should land on GitHub and a Vercel production/preview URL.

## GitHub

```sh
cd /path/to/wetdrool-web
git status -sb
git checkout -b feat/product-hub   # or work on main if agreed
# stage product paths deliberately; avoid committing secrets, .vercel, .env
git add apps/web docs workers packages/mesh apps/wallet-alpha
git commit -m "feat(web): product hub and docs vault"
git push -u origin HEAD
```

Remotes seen in checkouts:

- `origin` → droolyai/wetdrool (confirm access)
- legacy `wokesocial-legacy` → do not push product secrets there by accident

## Vercel

Mythic Agent team. Examples:

```sh
# static wallet alpha
cd apps/wallet-alpha
npx vercel@48 deploy --prod --yes --scope team_Kj8kBMsK5NG2fA3woisruvT6

# Next web (heavier; needs monorepo settings)
cd apps/web
npx vercel@48 deploy --prod --yes --scope team_Kj8kBMsK5NG2fA3woisruvT6
```

Never paste tokens into docs. CLI reads `~/Library/Application Support/com.vercel.cli/auth.json` when logged in.

## Cloudflare Worker

```sh
cd workers/wetdrool-edge
npm i
npx wrangler login
npx wrangler deploy
# attach wetdrool.com/* routes in dashboard
```

## “24/7” automation (recommended)

| Mechanism | Purpose |
| --------- | ------- |
| GitHub Actions on push | `pnpm verify` subset / web build |
| Vercel Git integration | Preview + prod deploys from `main` |
| Scheduled workflow (optional) | Health probe wetdrool.com + origin |

True 24/7 unattended **git push of dirty local trees** is unsafe. Prefer: CI on merge + scheduled health checks.

## Related

- [[Deploy — Vercel and Cloudflare]]
- [[00 Home — WetDrool Knowledge Base]]
