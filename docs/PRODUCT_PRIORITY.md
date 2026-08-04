# Product priority (P1 → P5)

**Status:** Active  
**Last updated:** 2026-08-04  
**Canonical product:** wetdrool.com web app (not a marketing brochure)

## Stack of priorities

| Priority | Surface | Goal | Status (honest) |
| -------- | ------- | ---- | --------------- |
| **P1** | Web2 web app | Tube hub + RedGIFs-class shorts + live rooms + creator studio + Reddit-like points + X-like compose/home | In progress — product routes exist; media fixtures synthetic |
| **P2** | Web3 browser dApp | Wallet connect, signed actions, `$DROOL` when mint is real, tips/subs settlement | Partial — token config mint-pending; wallet UI staged |
| **P3** | Solana Seeker (SKR) store | `apps/mobile` MWA client, dApp Store APK + portal submit | Foundation only — non-release |
| **P4** | Android general | Broader Android distribution beyond Seeker | Planned after P3 |
| **P5** | iPhone App Store | Expo iOS + store review | Planned; not live |

## What WetDrool *is* (product formula)

```text
wetdrool.com ≈
  RedGIFs (shorts)
  + Pornhub/RedTube (catalog / hub)
  + Twitch 18+ (live)
  + OnlyFans (creator paywalls, E2EE delivery target)
  + Reddit (points / communities)
  + X (timeline / compose)
  + local-first mesh (any-sync research)
  + Solana identity / $DROOL economy
```

**Not** a pitch landing page. Entry routes: `/hub`, `/feeds`, `/live`, `/home`, `/creator/*`.

## P1 definition of done

- [x] `/` redirects into product (hub), not marketing hero
- [x] Shorts with All / Straight / Pride modes (synthetic fixtures)
- [x] Hub catalog grid
- [x] Live room cards (staged join)
- [x] Creator offerings staged (sub / PPV / tip / live ticket)
- [x] Points ledger + ad-revenue issuance cap model
- [x] `$DROOL` 3% tax / RevShare config without inventing mint
- [ ] Next.js `/api/v1/*` product API fully wired from UI
- [ ] Durable points store (Redis/Postgres) — still local/in-memory alpha
- [ ] Real licensed media pipeline + ClamAV path for adult uploads

## P2 definition of done

- [ ] Injected wallet connect (signMessage first)
- [ ] Exact `$DROOL` mint in env + deployments record
- [ ] Tip/sub checkout against verified recipient
- [ ] No fake “live trading” UI before mint

## P3–P5

See [[00 Home — WetDrool Knowledge Base]] and `apps/mobile/README.md`. Seeker and iOS must not block P1.

## Related

- Vision: [WETDROOL_VISION.md](WETDROOL_VISION.md)
- Economy: [ECONOMY.md](ECONOMY.md)
- Deploy: [DEPLOY_VERCEL_CLOUDFLARE.md](DEPLOY_VERCEL_CLOUDFLARE.md)
- Mesh ADR: [DECISIONS/0014-any-sync-p2p-mesh-foundation.md](DECISIONS/0014-any-sync-p2p-mesh-foundation.md)
