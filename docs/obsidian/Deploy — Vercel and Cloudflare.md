---
tags: [wetdrool, deploy, vercel, cloudflare]
updated: 2026-08-04
---

# Deploy — Vercel and Cloudflare

Canonical: `docs/DEPLOY_VERCEL_CLOUDFLARE.md`  
Worker: `workers/wetdrool-edge/`

## Topology

```text
Browser
  → wetdrool.com (Cloudflare Full, orange cloud)
    → Worker wetdrool-edge (optional routes)
      → Vercel ORIGIN_URL
         e.g. https://wallet-alpha-dun.vercel.app
         later: Next apps/web production
```

## Zone status (operator)

Cloudflare dashboard shows **wetdrool.com protected**, Full DNS, free SSL scan cycle, **no Workers connected** until routes are attached.

### Recommended Free toggles

- CDN / DDoS / SSL / WAF: on by default  
- Bot Fight Mode: optional  
- AI training bot block: optional  
- SSL mode: aim for Full (strict) once origin cert path is clean  

## Worker health

`GET /.well-known/wetdrool-edge.json` after routes live.

## Vercel team

Mythic Agent (`team_Kj8kBMsK5NG2fA3woisruvT6`). Project `wallet-alpha` already has a production URL.

## GitHub

Remote example: `https://github.com/droolyai/wetdrool.git` (confirm org/repo ownership before push).

## Related

- [[Runbook — GitHub and Vercel Push]]
- [[00 Home — WetDrool Knowledge Base]]
