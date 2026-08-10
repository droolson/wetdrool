# WetDrool

**18+ adult social dApp** — euphoric feeds, livestreams, NSFW/SFW video, AI companions, `.drool` vanity, and `$DROOL` on Solana.

[![Status: pre-release](https://img.shields.io/badge/status-pre--release-f59e0b.svg)](#)
[![Network: Solana dapp](https://img.shields.io/badge/network-Solana%20dapp-14f195.svg)](#)
[![Age: 18+](https://img.shields.io/badge/age-18%2B-ff3d7f.svg)](#)

> Formerly **WokeSocial**. Product, packages, and docs rebranded to **WetDrool / Droolhouse**. Protocol layer is **DroolNet**.

| Name | Meaning |
|------|---------|
| **WetDrool** | Consumer product & monorepo |
| **Droolhouse** | AI company (Paperclip + Mythic agents) |
| **DroolNet** | Portable protocol + Anchor programs on Solana |
| **`$DROOL`** | Native token (mint pending — not live) |
| **`you.drool`** | Vanity namespace ($9.99/mo SOL/USDC/points) |
| **Mythic Agent** | Private Hermes SoT: [`canadasfemboy/mythic-agent`](https://github.com/canadasfemboy/mythic-agent) |

## Quick links

| Want… | Start here |
|-------|------------|
| Product vision | [docs/WETDROOL_VISION.md](docs/WETDROOL_VISION.md) |
| Economy (points ≤ ads) | [docs/ECONOMY.md](docs/ECONOMY.md) |
| DroolRank algorithm | [docs/ALGORITHM.md](docs/ALGORITHM.md) |
| Mythic performance | [docs/MYTHIC_PERFORMANCE.md](docs/MYTHIC_PERFORMANCE.md) |
| Paperclip company | [paperclip/droolhouse/](paperclip/droolhouse/) |
| Dev setup | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

## Hard rules

- **18+ only** with age gate before NSFW
- Near-total freedom for **consensual adult** expression
- **Zero tolerance:** CSAM, NCII, hate, bullying, bigotry, harassment, doxxing, real-world crime help
- Points issuance **never exceeds ad revenue**
- Mental health resources always linked
- Human moderation = **last resort**; AI triage 24/7

## Stack (monorepo)

- `apps/web` — Next.js flagship (feeds, live, companions, vanity, Grok dock)
- `apps/*-service` — auth, feed, moderation, media, indexer, relay
- `programs/social_protocol` — Solana / Anchor
- `packages/*` — protocol, crypto, SDK, UI, storage

```bash
pnpm install
pnpm setup
pnpm dev
```

## Grok chat (frontend now)

Floating **Ask Drool** dock is wired without a backend. When you have a key:

```bash
export WETDROOL_GROK_API_KEY=...   # or XAI_API_KEY
export WETDROOL_GROK_ENDPOINT=https://api.x.ai/v1/chat/completions
```

Then implement the server route that calls xAI (not committed until you approve).

## Paperclip + Mythic

1. Finish Hermes wiring (`hermes status`, gateway, models)
2. `npx paperclipai onboard --yes`
3. Install `hermes-paperclip-adapter`, register `hermes_local`
4. Import `./paperclip/droolhouse`

See [paperclip/droolhouse/README.md](paperclip/droolhouse/README.md).

## License

Source-available dual license — see [LICENSE](LICENSE) and [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).

## Support the studio

Drooly ships free, open, web-first software from a one-person studio. If you want it to
keep existing, you can tip at **[drooly.ai/support](https://drooly.ai/support)** — card or
BTC/ETH/SOL. A tip grants nothing: no perks, no credits, no priority. That is the whole deal.
