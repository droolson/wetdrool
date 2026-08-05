# WetDrool product FE/BE loop

**Loop:** durable scheduler every **30 minutes**.  
**Focus:** frontend + backend development for the WetDrool **platform/app** (`apps/web` + service APIs + shared packages as needed).  
**Not the focus:** revenue theater, deploy thrash, marketing pages, re-adding removed founder video drops.

## Scope

| Layer | Primary |
|-------|---------|
| Frontend | `apps/web` App Router routes + components |
| Backend (web) | `apps/web/app/api/v1/*` product APIs |
| Backend (services) | auth / indexer / feed / relay / media / moderation when wiring requires it |
| Shared | `packages/protocol`, `sdk`, `storage`, `config`, `ui`, `indexer-client` |

## Removed (do not restore)

- `/video/cumdump`, CUMDUMP media, HAIL SATAN · EVIL founder drop

## Priority stack

1. Product API completeness and honesty  
2. Wire UI ↔ APIs with real state semantics  
3. Marketplace (store + x402 UX)  
4. E2EE rooms  
5. Feeds & discovery  
6. Auth/passkey integration  
7. Shared packages only when needed  
8. Build/deploy fixers only when blocked  

## Sprint log

### 2026-08-05T16:26Z — wire Live / Fame / Creator UI → product APIs

- **Task:** P2 wire UI ↔ `/api/v1/*` with loading / error / local-fallback states.
- **BE:** `lib/live-catalog.ts` (shared catalog); `api/v1/live` uses it + optional `nsfw=0` filter + POST 405; status POST uses `jsonError`.
- **FE:** `live-rooms`, `hall-of-fame-board`, `creator-studio` fetch via `product-client` (`fetchLiveRooms`, `fetchFameBoard`, `fetchCreator`); honest badges for api vs local.
- **Lib:** `rankBoardWithSeed` for API seed + local grinder merge (drops spoofed local rows).
- **Verify:** `pnpm --filter @wetdrool/web exec vitest run tests/product-api-helpers.test.ts tests/short-feed.test.ts` → 12 passed.
- **Next:** Marketplace store abstraction + x402 unlock UX (P3), or harden rooms messages API pagination.

### 2026-08-05 — loop retargeted

- Scheduler prompt switched from production/revenue mission → **FE/BE platform development**.
- Next fire should pick a P1–P5 product slice (API + UI), not DNS or earnings claims.
