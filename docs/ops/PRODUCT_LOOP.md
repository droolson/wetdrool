# WetDrool product FE/BE loop

**Loop:** durable scheduler every **15 minutes** with **parallel agent swarm fanout** (see `docs/ops/SWARM_LOOP.md`).  
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

### 2026-08-05T21:00Z — 15m product swarm (A–F)

- **Task:** Parallel product FE/BE: health/stores, explore, market q=, rooms index, auth next-step, live pagination.
- **Verify:** vitest 42 passed (scoped suites above).
- **Next:** personalized explore provider (honest empty), e2e for new surfaces.


### 2026-08-05T20:26Z — E2EE rooms optional file-backed store

- **Task:** P4 room ciphertext store abstraction (memory | file via `WETDROOL_ROOMS_DATA_PATH`).
- **BE:** `lib/room-store.ts` file/memory bags; messages API + `/api/v1/e2ee` report durable flags.
- **FE:** room chat notes durable vs ephemeral store; `.env.example` documents path.
- **Verify:** vitest room-store → 4 passed.
- **Next:** explore discovery product API, or health aggregate of store kinds.

### 2026-08-05T19:56Z — fame seed pagination + providers auth status

- **Task:** P1 fame API pagination; providers page auth deep-link.
- **BE:** `pageFameSeed` + `GET /api/v1/fame?limit&offset` (`seedOnly`, `globalLedger: false`).
- **FE:** Hall of Fame load-more seed ranks; settings/providers embeds `AuthServiceStatus`.
- **Verify:** vitest product-api-helpers → 8 passed.
- **Next:** e2ee rooms file store optional, or explore feed API polish.

### 2026-08-05T19:26Z — privacy age policy UI + creators directory API

- **Task:** Settings/privacy age policy surface (API-backed) + creators list API/UI.
- **BE:** `GET /api/v1/creators` directory; handle route uses `resolveCreatorProfile`; catalog helpers in `creator-economy`.
- **FE:** `AgeAccessPolicyPanel` (region hint + API); `CreatorsDirectory` + `/creators` page; nav to `/creators`.
- **Verify:** vitest product-api-helpers + age-access-policy → 15 passed.
- **Next:** fame pagination or providers page auth deep-link.

### 2026-08-05T18:56Z — token + age policy API honesty and token UI wire-up

- **Task:** P1 product API completeness for `/api/v1/token` + `/api/v1/policy/age`; wire token page.
- **BE:** token honest flags (mintExists, earningClaimed, tradeExecutable); age policy region validation + flags; POST 405 both.
- **FE:** `TokenEconomy` client loads API; nsfw toggle refreshes age policy from API; `fetchAgePolicy` client.
- **Verify:** vitest product-api-helpers + age-access-policy + short-feed → 22 passed.
- **Next:** settings/privacy age policy surface, or creators API pagination.

### 2026-08-05T18:26Z — auth service status API + passkey surface wiring

- **Task:** P6 connect web sign-in/onboarding/devices to honest auth-service readiness.
- **BE:** `lib/auth/auth-service-config.ts` (URL resolve, legacy host reject, healthz/readyz probe); `GET /api/v1/auth/status`; health lists `auth`.
- **FE:** `AuthServiceStatus` on sign-in, onboarding, settings/devices; pages use `resolveAuthServiceConfig()`.
- **Verify:** vitest `auth-service-config` (+ related if run).
- **Next:** Token/policy API polish or settings/providers auth deep-link.

### 2026-08-05T17:56Z — feeds & discovery ranking + synthetic labels

- **Task:** P5 shorts/hub discovery ranking, category filters, honest synthetic labels.
- **BE:** `lib/short-feed.ts` (`rankShortsPage`, category/offset, weights, syntheticLabel); `api/v1/shorts` category/pagination/ranking meta; `fetchShorts` options.
- **FE:** `short-feed` category chips + error/retry + content-warning labels; `hub-catalog` wired to API with mode/category.
- **Verify:** vitest short-feed + product-api-helpers → 14 passed.
- **Next:** P6 auth/passkey surfaces, or hub CSS for synth badges if needed.

### 2026-08-05T17:26Z — E2EE rooms API pagination + UI polish

- **Task:** P4 rooms message API + anon gate / feed accessibility.
- **BE:** `lib/room-store.ts` (limit/after, dedupe, meta), `api/v1/rooms/[roomId]/messages` pagination + idempotent POST; `product-client.fetchRoomMessages`.
- **FE:** `e2ee-room-chat` loading/error/retry, poll-after, wrong-key count, passphrase hint, a11y labels; `custom-room-jump` uses `normalizeRoomId`.
- **Verify:** vitest `room-store` + `e2ee-seal` → 5 passed.
- **Next:** P5 feeds/discovery ranking labels, or auth/passkey wiring (P6).

### 2026-08-05T16:56Z — marketplace store abstraction + x402 UX

- **Task:** P3 durable listing store + clearer unlock UX + honest store/gate flags.
- **BE:** `lib/marketplace-store.ts` (memory | file via `WETDROOL_MARKETPLACE_DATA_PATH`), `lib/marketplace-unlock.ts` (stable gate via `WETDROOL_MARKETPLACE_GATE_SECRET`), market GET pagination + store meta; file mode requires gate secret; `revenue-readiness` reports store/gate.
- **FE:** marketplace loading/error/retry, store badges, unlock step list, copy payTo, `fetchMarket` client.
- **Verify:** vitest marketplace-store + revenue-readiness + x402 + product-api-helpers → 21 passed.
- **Next:** E2EE rooms polish (P4) or multi-replica market backend when needed.

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
