# WetDrool revenue / production loop

**Loop:** durable scheduler every **30 minutes** (agent session).  
**Canonical product origin:** `https://wetdrool.com`  
**Do not claim earnings without verified SOL settlement evidence.**

## Honest status (2026-08-05)

| Item | State |
|------|--------|
| Full Next product (`apps/web`) on wetdrool.com | **Not live** — CF NS present, no public A/AAAA |
| **Interim product URL** | **`https://wetdrool-web.vercel.app`** (Vercel project `wetdrool-web`, mythicagent team) |
| Legacy static | `https://wallet-alpha-dun.vercel.app` = wallet-alpha only (not product) |
| Marketplace x402 | Live API on interim URL; **in-memory store**; RPC env set (devnet public); `revenueReady: false` |
| `$DROOL` mint | **Does not exist** — never invent it |
| CUMDUMP founder drop | Live at `/video/cumdump` + `/media/cumdump.webm` on interim URL |
| Onion gateway | Code in `apps/onion`; needs real `.onion` host |

## Revenue blockers (ordered)

1. **DNS:** Point `wetdrool.com` / `www` A/AAAA (or CNAME) at Vercel project **wetdrool-web** (not wallet-alpha).
2. ~~**Deploy product shell**~~ — interim URL live; keep redeploys on monorepo build path.
3. **Mainnet RPC + operator `payTo`:** production still on devnet public RPC for verify demos only.
4. **Durable marketplace store:** Replace process-global `Map` with Redis/Postgres (or accepted single-region risk with external DB).
5. **Traffic + age policy:** 18+ self-attest on shorts/market/CUMDUMP (UI gate shipped); legal/ToS for adult sales still needed.
6. **First paid unlock:** Confirmed mainnet (or declared devnet demo) tx → unlock secret released.

## Sprint log

### 2026-08-05T16:08Z — P0/P1 product live on Vercel interim URL

- Created Vercel project `wetdrool-web` (`prj_XuGVbO9dFScPwXdJaclHcIzKPNkq`, team mythicagent).
- Fixed monorepo deploy blockers: restored `packages/protocol/schemas/wetdrool-signed-envelope-v1.schema.json`; WebCrypto `BufferSource` strict TS fixes; `apps/web/tsconfig.json` excludes e2e/tests so Next does not typecheck `auth-service`.
- Added root `.vercelignore` (skip `.anchor`/ledgers/`node_modules`).
- Production deploy: **https://wetdrool-web.vercel.app**
- Smoke (HTTP): `/api/v1/health` 200, `/api/v1/status` 200 (`revenueReady:false`, `rpcConfigured:true`, store `memory-ephemeral`), `/feeds` `/market` `/video/cumdump` `/rooms/lobby` `/hub` 200, `/media/cumdump.webm` 200 video/webm.
- Env on project: `WETDROOL_SOLANA_RPC_URL` + `NEXT_PUBLIC_SOLANA_*` → public **devnet** RPC (not mainnet earnings).

**Still blocking revenue:** wetdrool.com DNS not attached; market store ephemeral; no durable receipts; no operator mainnet payTo; no verified paid unlock.

**Next sprint pick:** durable marketplace store (Upstash/Redis REST or Postgres) + attach wetdrool.com DNS to `wetdrool-web` project.

### 2026-08-05T15:30Z — P4 age gate + x402 fail-closed tests

- Shared `AgeGatePanel` (localStorage 18+ self-attest, no gov ID).
- Gated `/market` marketplace UI and `/video/cumdump` player behind age gate.
- Market `GET /api/v1/market` exposes `paymentVerify.rpcConfigured` so UI can show fail-closed RPC state.
- Health JSON includes marketplace unlock + age-gate metadata (still `revenueReady: false`).
- Extended `tests/x402.test.ts`: no_rpc / invalid sig / insufficient amount / happy-path balance delta.

**Verify:** `apps/web` vitest `tests/x402.test.ts` + `tests/revenue-readiness.test.ts` — 10 passed.

**Still blocking revenue:** no production `apps/web` on wetdrool.com; ephemeral market Map; RPC/payTo not set in prod; DNS A/AAAA missing.

**Next sprint pick:** deploy `apps/web` to a Vercel product URL (monorepo install/build per `DEPLOY_WEB.md`) + set `WETDROOL_SOLANA_RPC_URL` on that project.

### 2026-08-05 — loop boot + P0 deploy readiness

- Created 30m durable agent loop (mission: production + revenue rails).
- Added `docs/ops/DEPLOY_WEB.md` monorepo Vercel + DNS checklist.
- Added `lib/revenue-readiness.ts` + `/api/v1/status` honest readiness JSON.
- Extended health surface list; no fake “earning” fields.

**Still blocking revenue:** no production `apps/web` deploy on wetdrool.com; market store ephemeral; RPC/payTo env not production-set.

**Next sprint pick:** get `apps/web` building on Vercel (or fix monorepo install/build commands) and wire status page to readiness API.

## Loop rules for agents

1. One coherent vertical slice per fire.
2. Update this log every sprint.
3. Never mark `earning: true` without a verified payment path and documented production URL.
4. Prefer deploy/payment/age-gate over cosmetic UI.
