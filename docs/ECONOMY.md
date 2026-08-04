# WetDrool Economy — Points, Ads, and $DROOL

**Status:** Spec for implementation  
**Last updated:** 2026-07-30

## Principles

1. **Gamification is #1** for retention — hot, fun, erotic, engaging.
2. **Points never exceed advertising revenue** for the same accounting window.
3. **`$DROOL` is on-chain utility**, not a substitute for unbacked points inflation.
4. Users can always participate in SFW reading without buying anything.

## Points (off-chain ledger)

### Earn (relative, soft-capped)

| Action | Base points | Notes |
|--------|------------:|-------|
| Daily check-in | 5 | Streak multipliers soft-cap |
| Post (quality pass) | 3–15 | AI quality score gates spam |
| Reply / meaningful comment | 1–5 | Length + reply-graph quality |
| Photo upload | 2–8 | Dedup + NSFW label required |
| Video publish | 10–40 | Duration + retention |
| Livestream minute (host) | 1–3 | Viewership weighted |
| Watch complete (short) | 1 | Anti-farm: unique creators |
| Tip / support sent | 0 | Spend side only |
| Companion session (paid) | 0 | Spend side |

Anti-farm: velocity caps, device/account graph, quality classifiers, diminishing returns.

### Spend

- Vanity `name.drool` subscription (if paying in points)
- Handle change, cosmetics, avatar layers
- Feed boosts (transparent, labeled)
- Livestream support bundles
- Companion hire minutes

### Global issuance constraint

```
points_issued_period ≤ ad_revenue_period_in_points_units
```

Where `points_units` converts USD/SOL ad revenue via a published oracle rate updated daily.  
If ad revenue is zero, points issuance freezes except non-transferable reputation (if any).

Implementation: `apps` economy service (planned) + indexer projections for public transparency reports.

## Vanity — `address.drool`

**Price:** $9.99 / month  
**Pay with:** SOL, USDC, or points (points path subject to issuance cap)

Perks:

1. Free username/handle change during active sub
2. Verification check after AI review
3. Full profile + avatar customization (Reddit-cool+)

Reservation: on-chain name registry (DroolNet program extension) + off-chain UX.

## $DROOL (mint soon)

- SPL / Token-2022 candidate on Solana
- Use: tips, vanity settlement, creator payouts, stream support
- **Not** required to read the network
- No false claims of live mint until mint address + program IDs are published in `network/solana/deployments.json`
- **Transfer tax target:** 3% (300 bps) on [revshare.dev](https://revshare.dev/) launch rail — configured in `apps/web/lib/drool-token.ts`
- **Robinhood:** planned visibility path only; not a live listing claim
- Env when live: `NEXT_PUBLIC_DROOL_MINT` (+ optional `NEXT_PUBLIC_DROOL_TRADE_URL`)

## Ads

- Labelled, skippable where required by policy
- Revenue feeds the points ceiling
- Adult-safe ad inventory; no malware, no scams, no CSAM-adjacent

## Mental health budget

A fixed % of ad revenue (recommended 1%) reserved for mental health resource partnerships and crisis link infrastructure — not points.
EOF