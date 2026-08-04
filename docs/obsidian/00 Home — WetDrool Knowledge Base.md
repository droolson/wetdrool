---
tags: [wetdrool, index, obsidian]
updated: 2026-08-04
---

# WetDrool knowledge base

Obsidian-first notes for the **WetDrool** monorepo. Public mirror target: **https://wetdrool.com/docs**.

> **Honest status:** pre-release. Local and staged product UI ≠ production adult media network. No invented `$DROOL` mint. No CSAM. 18+ self-attest; Swiss foundation is planned operator vehicle, not “no laws.”

## Product formula

[[Product Formula — Hub Shorts Live Creators Social]]

```text
RedGIFs + Pornhub/RedTube + Twitch18+ + OnlyFans + Reddit + X
  = wetdrool.com product app
```

## Priority ladder

[[Product Priority P1 to P5]]

1. **P1 Web app** — dense product, not marketing  
2. **P2 Web3 dApp** — wallet + `$DROOL` when real  
3. **P3 Seeker store** — `apps/mobile`  
4. **P4 Android**  
5. **P5 iPhone App Store**

## Surfaces (P1)

| Surface | Route | Note |
| ------- | ----- | ---- |
| Hub (tube) | `/hub` | [[Surface — Hub Catalog]] |
| Shorts | `/feeds` | [[Surface — Shorts RedGIFs]] |
| Live | `/live` | [[Surface — Live Rooms]] |
| Creators | `/creator/*` | [[Surface — Creator Studio]] |
| Social home | `/home` | Indexer-backed when configured |
| Compose | `/compose` | X-like post draft |
| Private | `/messages` | [[Surface — Private E2EE]] |
| Token | `/token` | [[Economy — Points and DROOL]] |
| Mesh | `/mesh` | [[Mesh — any-sync Foundation]] |
| AI | `/ai` | [[AI — Drool and DROOLY]] |

## Stack

- [[Deploy — Vercel and Cloudflare]]
- [[Architecture — Authority Planes]]
- [[Safety — Age Access and Hard Bans]]
- [[Brand — WetDrool Identity]]

## Repo map

| Path | Role |
| ---- | ---- |
| `apps/web` | Flagship Next.js product |
| `apps/wallet-alpha` | Static wallet protocol alpha (Vercel) |
| `apps/mobile` | Seeker / Android foundation |
| `apps/indexer` | Projection API |
| `packages/protocol` | Portable objects SoT |
| `packages/mesh` | any-sync contracts |
| `packages/messaging` | Pairwise E2EE adapter |
| `workers/wetdrool-edge` | CF Worker → Vercel |
| `docs/` | Specs + this vault |

## Engineering rules (short)

- Fail closed. Never fake verified media, live mint, or E2EE production.
- Wallet ≠ age proof.
- Points ≤ ad revenue units for the period.
- Mesh is local-first; edge HTTP is not the mesh.
- See root `AGENTS.md` / `CLAUDE.md`.

## Decision log

- [[ADR Index]]
- Full ADRs live in `docs/DECISIONS/`.

## Daily ops

- [[Runbook — Local Dev]]
- [[Runbook — GitHub and Vercel Push]]
- [[Honcho Sync Queue]]
