---
tags: [wetdrool, economy, token]
updated: 2026-08-04
---

# Economy — Points and `$DROOL`

Canonical: `docs/ECONOMY.md`  
Code: `apps/web/lib/points.ts`, `points-ledger.ts`, `drool-token.ts`  
UI: `/token`

## Points (Reddit-like, off-chain)

- Earn: check-in, post, reply, photo, video, live host min, **watch complete**
- Spend: vanity, cosmetics, boosts, tips (when enabled)
- **Global cap:** `points_issued_period ≤ ad_revenue_point_units`
- Empty ad revenue → issuance freezes (honest)

Device ledger is local alpha; production needs a service ledger + transparency report.

## `$DROOL`

| Field | Value |
| ----- | ----- |
| Symbol | `$DROOL` |
| Status default | `mint-pending` |
| Tax target | **3%** (300 bps) |
| Launch rail | [revshare.dev](https://revshare.dev/) |
| Robinhood | planned visibility — **not** a live listing |
| Env when live | `NEXT_PUBLIC_DROOL_MINT` |

**Never** invent a mint address. **Never** call SOL `$DROOL`.

## Pro mode

$9.99/mo class perks (vanity + no-ads + cosmetics) — checkout staged until settlement rails exist.

## Related

- [[Product Priority P1 to P5]]
- [[Surface — Creator Studio]]
