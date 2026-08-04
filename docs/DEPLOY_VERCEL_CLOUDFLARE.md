# Deploy: Vercel + Cloudflare Worker + Mesh

## Topology

```text
Browser
  → wetdrool.com (Cloudflare Full DNS, orange cloud)
    → Worker wetdrool-edge (optional but recommended)
      → ORIGIN_URL = https://wallet-alpha-dun.vercel.app  (or Next apps/web)
  → local mesh (packages/mesh / future any-sync) — client-side, not CF
```

## 1. Vercel origin (Mythic Agent team)

Project in use: **wallet-alpha** → https://wallet-alpha-dun.vercel.app

```bash
cd apps/wallet-alpha
npx vercel@48 deploy --prod --yes --scope team_Kj8kBMsK5NG2fA3woisruvT6
```

Later: deploy `apps/web` (Next) as `wetdrool-web` with monorepo root settings.

## 2. Cloudflare zone (already active)

You completed Full setup for **wetdrool.com**. Defaults (CDN, DDoS, SSL, WAF) stay on.

Recommended Free-plan toggles (your call):

- Bot Fight Mode: ON for scraping resistance  
- AI training bot block: optional  
- Client-side security: review before ON (may flag first-party scripts)

SSL/TLS: prefer **Full (strict)** once Vercel cert path is healthy.

## 3. Worker `wetdrool-edge`

```bash
cd workers/wetdrool-edge
npm install
npx wrangler login
npx wrangler deploy
```

Dashboard → Worker → **Domains & Routes** → add:

- `wetdrool.com/*`
- `www.wetdrool.com/*`

`ORIGIN_URL` defaults to `https://wallet-alpha-dun.vercel.app` in `wrangler.toml`.

Health: `https://wetdrool.com/.well-known/wetdrool-edge.json` (after routes live).

## 4. DNS

| Type | Name | Target | Proxy |
| ---- | ---- | ------ | ----- |
| CNAME / A | `@` | Vercel / Worker as per CF wizard | Proxied |
| CNAME | `www` | apex or vercel | Proxied |

Do **not** dual-point apex to random A records that bypass Vercel once Worker owns `/*`.

## 5. Anytype mesh code

Package: `packages/mesh` (`@wetdrool/mesh`)  
ADR: `docs/DECISIONS/0014-any-sync-p2p-mesh-foundation.md`

Mesh is **not** deployed on Cloudflare Workers. It is local-first client code with
any-sync as the future protocol binding.

## 6. GitHub

Remote: `https://github.com/droolyai/wetdrool.git`

Track Worker + mesh + wallet-alpha on a branch and push so deploys are reproducible.
