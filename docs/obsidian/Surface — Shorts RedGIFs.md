---
tags: [wetdrool, surface, shorts]
updated: 2026-08-04
---

# Surface — Shorts (RedGIFs-class)

**Route:** `/feeds`  
**Code:** `apps/web/components/short-feed.tsx`, `lib/short-feed.ts`

## Modes (local, never inferred)

- **All**
- **Straight**
- **Pride** (trans / femboy / queer emphasis)

## Ranking (DroolRank-lite)

Weights:

- 35% provenance readiness  
- 20% recency  
- 20% novelty  
- 10% engagement (capped 0.75)  
- 15% mode match  

UI exposes “Why” chips from top signals.

## Points

Finishing a short attempts `watch_complete` via `lib/points-ledger.ts` under ad-revenue cap. Empty ad pool → issuance frozen (honest).

## Age

NSFW requires [[Safety — Age Access and Hard Bans]] self-attest 18+.

## Related

- [[Economy — Points and DROOL]]
- [[Surface — Hub Catalog]]
