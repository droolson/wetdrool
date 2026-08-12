# Deploy `@wetdrool/web` to production

## Target

| Role | Value |
|------|--------|
| Package | `@wetdrool/web` → `apps/web` |
| Framework | Next.js 16 App Router |
| Canonical host | `wetdrool.com` (never legacy host as WebAuthn/app origin) |
| Production URL | **https://wetdrool.com** (project `wetdrool-web`, team mythicagent) |
| Vercel project id | `prj_XuGVbO9dFScPwXdJaclHcIzKPNkq` |
| Node | `22.23.1` (see root `engines`) |
| Package manager | pnpm `11.2.2` via Corepack |

> **Honest:** the canonical origin serves the real production product shell. This does **not** imply revenue-ready commerce (`/api/v1/status` → `revenueReady: false`). See `docs/ops/PRODUCTION_WEB_2026-08-12.md` for the deployment receipt.

## Vercel project settings

Create or update a project dedicated to **product web** (do not repoint wallet-alpha static project without understanding the impact).

| Setting | Value |
|---------|--------|
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Node.js Version | 22.x (prefer 22.23.x) |
| Install Command | `cd ../.. && corepack enable && pnpm install --frozen-lockfile` |
| Build Command | `cd ../.. && pnpm --filter @wetdrool/web... build` |
| Output | Next default (no static export) |
| Include files outside root | **Yes** (required for monorepo `workspace:*` packages) |

`apps/web/vercel.json` sets security headers and framework; keep install/build in project UI if monorepo paths need adjustment.

## Environment (public-safe examples only)

Production fails closed for secrets. Minimum for a **read-only** product surface:

```bash
NODE_ENV=production
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta   # or devnet until ready
NEXT_PUBLIC_SOLANA_RPC_URL=https://<your-public-or-proxied-rpc>
```

For **marketplace x402 unlock verification**:

```bash
WETDROOL_SOLANA_RPC_URL=https://<server-side-rpc>   # preferred over NEXT_PUBLIC for verification
# Optional: listing encryption material if you rotate marketplace unlock wrap keys
```

Never commit real RPC keys with embedded credentials if policy forbids them (`packages/config` rejects userinfo in some URLs).

## DNS (Cloudflare → Vercel)

Observed: `wetdrool.com` NS → Cloudflare; **no A/AAAA** in public resolvers (site not live).

1. In Vercel project → Domains → add `wetdrool.com` and `www.wetdrool.com`.
2. In Cloudflare DNS:
   - Apex: A/AAAA records Vercel provides, **or** CNAME flattening to `cname.vercel-dns.com` as Vercel instructs.
   - `www` → CNAME to Vercel target.
3. Proxy (orange cloud) optional; if orange-clouded, ensure SSL mode Full (strict) and no broken page rules.
4. After DNS propagates: `curl -sI https://wetdrool.com/api/v1/status` should return JSON readiness.

## Redeploy (CLI, monorepo root)

Requires Vercel CLI auth and project link (`.vercel/project.json` is local/gitignored).

```bash
# from monorepo root
export VERCEL_ORG_ID=team_Kj8kBMsK5NG2fA3woisruvT6
export VERCEL_PROJECT_ID=prj_XuGVbO9dFScPwXdJaclHcIzKPNkq
npx vercel@48 deploy --prod --yes --scope team_Kj8kBMsK5NG2fA3woisruvT6
```

Root `.vercelignore` must exclude `.anchor/`, `target/`, ledgers, and `node_modules` or upload fails.

## Smoke checklist after deploy

Interim (live):

```bash
curl -sS https://wetdrool-web.vercel.app/api/v1/health | jq .
curl -sS https://wetdrool-web.vercel.app/api/v1/status | jq .
curl -sS -o /dev/null -w '%{http_code}\n' https://wetdrool-web.vercel.app/feeds
curl -sS -o /dev/null -w '%{http_code}\n' https://wetdrool-web.vercel.app/market
```


Canonical (after DNS):

```bash
curl -sS https://wetdrool.com/api/v1/health | jq .
curl -sS https://wetdrool.com/api/v1/status | jq .
```

Expect `revenueReady === false` until durable market + real payTo path are production-complete.

## What is NOT production revenue

- wallet-alpha static site (`wallet-alpha-*.vercel.app`) — CSP `connect-src 'none'`, no market API.
- In-memory marketplace listings (lost on cold start / multi-instance).
- Points ledgers that are localStorage-only.
- Claiming `$DROOL` exists.

## Local production build smoke

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @wetdrool/web... build
pnpm --filter @wetdrool/web start
# then curl http://127.0.0.1:3000/api/v1/status
```
