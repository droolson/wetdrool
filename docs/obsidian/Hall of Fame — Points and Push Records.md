---
tags: [wetdrool, fame, points, github]
updated: 2026-08-04
---

# Hall of Fame — points and push records

## Product board

- **Route:** `/fame`
- **Code:** `apps/web/lib/hall-of-fame.ts`, `components/hall-of-fame-board.tsx`
- Grind: daily check-in + watch points (ad-cap honest; practice pool for local demo)
- Seed leaderboard + your local browser row

## GitHub push cadence (record attempt)

GitHub **scheduled workflows cannot run every second**. Practical max is about **every 5 minutes**.

| Piece | Location |
| ----- | -------- |
| Workflow | `.github/workflows/hall-of-fame-heartbeat.yml` |
| Branch | `hall-of-fame` (keeps spam off `main`) |
| Counter | `ops/hall-of-fame/counter.json` |
| Ledger | `ops/hall-of-fame/ledger.ndjson` |

Enable: merge workflow to default branch, ensure Actions write permission for `GITHUB_TOKEN`, create/push `hall-of-fame` branch once if needed.

Manual fire: Actions → **Hall of Fame heartbeat** → Run workflow.

### Limits (honest)

- GitHub may skip or delay cron under load  
- Abuse / empty-commit spam can trip abuse detection — heartbeats only touch `ops/hall-of-fame/*`  
- Guinness / external “world records” are **not** verified by this repo  

## Related

- [[Economy — Points and DROOL]]
- [[Runbook — GitHub and Vercel Push]]
