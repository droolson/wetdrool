---
tags: [wetdrool, api, p1]
updated: 2026-08-04
---

# Product API v1

Base: `/api/v1/*` on `apps/web` (Next.js route handlers).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/health` | Product health |
| GET | `/api/v1/shorts?mode=&limit=` | Ranked shorts (synthetic) |
| GET | `/api/v1/live` | Live room cards (staged) |
| GET | `/api/v1/creators/[handle]` | Creator studio profile |
| GET | `/api/v1/token` | `$DROOL` config + pro quote |
| GET | `/api/v1/policy/age?region=` | Age access policy |
| GET | `/api/v1/e2ee` | Messaging capability |
| GET | `/api/v1/fame` | Seed hall of fame board |
| POST | `/api/v1/ai/chat` | Grok via **xAI** only |

## Client

`apps/web/lib/product-client.ts` — shorts fetch with local fallback.

## Related

- [[Surface — Shorts RedGIFs]]
- [[Hall of Fame — Points and Push Records]]
- [[AI — Drool and DROOLY]]
