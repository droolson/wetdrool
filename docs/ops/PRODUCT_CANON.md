# PRODUCT CANON — $DDD · WetDrool · Grok sessions

**Read this first** in any Grok / Hermes / Paperclip session touching DROOLY.AI games.

## One franchise, two ratings

| Track | Rating | Live URL | Repo path |
|-------|--------|----------|-----------|
| **$DDD Games** | **SFW** | https://drooly.ai/games/ddd | `repos/drooly-web/games/ddd/` |
| **WetDrool** | **18+** | https://drooly.ai/games/wetdrool | `repos/drooly-web/games/wetdrool/` |

- **Same IP / same city / same leads.** WetDrool is the **adult twin** of $DDD, not a separate universe.
- **wetdrool.com:** play via `/play` (and related paths) → 18+ arena. Apex may still host $DOOCHIE culture — do not claim apex HTML *is* the full game unless verified.
- Economy token: **`$DDD`** (real crypto + in-game when minted). **No $DDD CA until @kingofqueens6ix posts it.** **`$DROOL` does not exist.**

## What $DDD *is* (story)

Working title energy was “GTA VII” fan-pitch — **ship as original IP only.**

- **Setting: Maple City** — digital Toronto, Ontario. Locals call it the **#6ix**.
- **Leads:**
  - **Darius “D-Roc” King** — hip-hop rise from the 6ix; good intentions; trouble from being himself.
  - **Ari Pink** — co-lead; creator/connector; same streets, same hunger.
- **Thesis:** They mean well, still find trouble, because they have the guts to be who they want to be (classic crime-cinema swagger **paraphrase only** — no full Scarface dialogue in product).
- **Target theme:** Giorgio Moroder — *The World Is Yours* → **license required**; do **not** embed the commercial track. Shipping radio: Icefam / owner loops until licensed.
- **Not Rockstar, not GTA, not Drake-as-character.** Homage craft only.

Full lore: `repos/drooly-web/games/ddd/LORE.md` (sibling repo)

## Modes (roadmap)

1. **Arena (.io)** — live now at `/games/ddd` (SFW) and `/games/wetdrool` (18+)
2. **Story Run (2D)** — play as D-Roc or Ari
3. **Open City (3D)** — long-term Maple City quality bar

## Distribution — web forever until forced off web

**Default forever: the game is a website.** Play in the browser at drooly.ai (and wetdrool play paths). No app-store dependency, no required desktop installer, no “download to play” as the primary product.

| Principle | Rule |
|-----------|------|
| **Primary surface** | HTTPS web (static + serverless APIs). Progressive enhancement OK (PWA, offline cache) — still **web**. |
| **Ship velocity** | Prefer features that work in modern browsers without a native binary. |
| **Hermes / AI** | Companion & agents via web APIs (Hermes ingress) — not a separate desktop client as the core game. |
| **Do not** | Build Steam/App Store/Epic/native mobile **as the default path** while web still carries the experience. |
| **Do not** | Block web players to force a software install. |

### When (and only when) to distribute as software

Leave pure web **only** when the product **outgrows** the browser for **demonstrated** reasons, e.g.:

1. **Performance / GPU** — open-city 3D or fidelity that browsers cannot sustain for the target audience after honest measurement.
2. **OS integrations** — hard requirements (anti-cheat kernel, platform-only APIs, store-mandated packaging) with a real product need.
3. **Offline / installable package** — user demand for a packaged client after web + PWA is proven insufficient.
4. **Platform deals** — explicit business requirement (console, storefront) that cannot be met by a web view alone.

Until one of those is **written down with evidence**, agents ship **web**. Any future native/client build is an **additive** channel (same account/economy/lore), not a replacement that abandons drooly.ai/games/*.

**Decision id:** `DIST-WEB-FIRST-001` · see drooly-web `docs/DECISIONS/0001-web-first-distribution.md`.

## Multi-session (all Grok + Hermes)

1. **`plans/DDD-SESSION-HANDOFF.md`** — source of truth (alias: `plans/SESSION-HANDOFF-DDD.md`)
2. **`plans/DDD-GAME-LOCK.md`** — soft lock so sessions don’t clobber each other
3. **`plans/DDD-24-7-ACTIVE.flag`** — 24/7 loop ON
4. Append **`plans/DDD-GAME-PROGRESS.md`** when you ship

## Repos & agents

| Work | Repo | Agent bible |
|------|------|-------------|
| Games + drooly.ai | `repos/drooly-web` | This file + `AGENTS.md` + `games/ddd/LORE.md` + workspace handoff |
| wetdrool.com / monorepo / Paperclip pack | `repos/wetdrool-web` | `docs/ops/GAME_WETDROOL.md` + `paperclip/droolhouse/` |
| Workspace map | `drooly-inc/` | root `AGENTS.md` |

## Rules for every Grok session

1. Do not invent mint addresses or claim `$DROOL`.
2. Keep **SFW** and **18+** paths distinct; never send minors to WetDrool.
3. Zero tolerance: CSAM, NCII, hate, harassment, doxxing, real-world crime facilitation.
4. Prefer shipping Maple City / D-Roc / Ari story surfaces over generic social-feature thrash when the task is games.
5. When two sessions conflict, **this canon + LORE.md win** for narrative; live URLs win for deploy status.
6. **Web-first forever** (`DIST-WEB-FIRST-001`): ship the browser game; do not default to native/app-store distribution until the game outgrows the web with written evidence.
