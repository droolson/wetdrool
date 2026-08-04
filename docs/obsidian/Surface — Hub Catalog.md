---
tags: [wetdrool, surface, hub]
updated: 2026-08-04
---

# Surface — Hub catalog

**Route:** `/hub`  
**Code:** `apps/web/components/hub-catalog.tsx`, `apps/web/app/hub/page.tsx`  
**Inspiration:** Pornhub / RedTube browse density

## Behavior

- Category toolbar (All, Femboy, Trans, Queer, Amateur, Couples, Cosplay, Solo, …)
- Tile grid from ranked short corpus
- Tiles link into shorts experience
- No fake “trending score” beyond transparent rank fields

## Data

Today: in-process fixtures via `lib/short-feed.ts`.  
Target: `/api/v1/shorts` + indexer/CAS manifests.

## Related

- [[Surface — Shorts RedGIFs]]
- [[Product Formula — Hub Shorts Live Creators Social]]
