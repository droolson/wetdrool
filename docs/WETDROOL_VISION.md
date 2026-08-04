# WetDrool / Droolhouse — Product Vision

**Status:** Active product direction (rebranded from WokeSocial foundation)  
**Last updated:** 2026-07-30  
**Canonical origin:** `https://wetdrool.com`  
**Vanity namespace:** `*.drool` (e.g. `you.drool`)  
**Protocol layer:** DroolNet on Solana  
**Native token:** `$DROOL` (to be minted; not yet live)  
**Org runtime:** Mythic Agent (`canadasfemboy/mythic-agent`) + Paperclip company **Droolhouse**

---

## 1. What WetDrool is

WetDrool is an **18+ adult social dApp** — a euphoric, gamified, X-elevated social platform with:

- Full Solana / DroolNet block integration
- NSFW video (X-rated YouTube-class) **and** SFW content, with a one-tap NSFW/SFW mode
- Livestreams with tip/support via points and `$DROOL`
- Next-level kink/fetish filters and dedicated safe spaces by gender identity and orientation
- Immersive AI sexbots / companions (Grok 4.5 + Hermes/Mythic) with human-feel DM RP
- Photo sharing, stories, communities, and creator tools
- A platform AI chat (Grok-like frontend now; backend when API key lands)
- Autonomous AI moderation 24/7 + a support “user” agent
- Mental health resources always one tap away

**Hard line:** almost complete freedom of speech and consensual adult expression.  
**Zero tolerance:** CSAM, non-consensual imagery, real-world crime facilitation, doxxing, hate, bullying, bigotry, targeted harassment. Illegal content is never allowed.

---

## 2. Brand system

| Name | Meaning |
|------|---------|
| **WetDrool** | Consumer product / flagship app |
| **Droolhouse** | AI-operated company org (Paperclip + Mythic agents) |
| **DroolNet** | Portable protocol + Solana program layer |
| **`$DROOL`** | Native utility/engagement token (mint pending) |
| **`handle.drool`** | Vanity address / username namespace |
| **Mythic Agent** | Private Hermes fork — org agent runtime SoT |

Tone: hot, playful, high-trust, consent-first, unapologetically adult, never cruel.

---

## 3. Age gate & consent

1. Hard 18+ gate on every entry surface (web, mobile, marketing deep links).
2. Age assurance path: self-attest + optional AI-assisted verification review for vanity/verified badges.
3. Media defaults to **NSFW mode off** until the user opts in after age confirmation.
4. Explicit consent metadata on DMs, livestreams, and companion sessions.
5. Report + block always available; no dark patterns that trap users in adult content.

---

## 4. Core product surfaces

### 4.1 Social graph (X-elevated)

- Home, Following, For You (DroolRank algorithm), Communities, Safe Spaces
- Posts: text, photos, short video, long video, polls, quotes, reposts
- Stories with ephemerality options
- Profile avatars: Reddit-cool customizer (layers, reactions, NSFW/SFW skins)
- Verification check after AI review (vanity perk)

### 4.2 Video (X-rated YouTube + SFW toggle)

- Channels, playlists, chapters, captions
- NSFW flag required at upload; algorithm respects mode toggle
- Monetization hooks: points, `$DROOL` tips, creator goals (noncustodial destinations)

### 4.3 Livestreams

- Real-time rooms with chat, reactions, and support
- Join with points or `$DROOL` tips
- Companion agents can co-host / interact under policy
- Recording + VOD optional with consent banner

### 4.4 AI companions (sexbots)

- Hireable 24/7; immersive RP in DM as if human
- Runtime: **Grok 4.5** primary + **Mythic/Hermes** tool/agent layer
- Limits: **illegal content only** (CSAM, non-consent, real-world harm, etc.)
- Memory scoped per user; export/delete on request
- Clear labeling: AI companion, never impersonating a real non-consenting person

### 4.5 Platform AI chat (Grok-like)

- Frontend-first chat dock (this repo)
- Backend wires when operator provides API key
- Uses same safety rails as companions + general assistant skills

### 4.6 Gamification & economy

| Loop | Behavior |
|------|----------|
| Engage | Post, reply, react, watch, stream, tip → earn **points** |
| Relative cap | Points issuance **must never exceed ad revenue** in the accounting period |
| Spend | Vanity handle, cosmetics, boosts, companion minutes, stream support |
| Token | `$DROOL` for on-chain tips, vanity settlement, future creator payouts |
| Vanity | `name.drool` — **$9.99/mo** in SOL / USDC / points |

Vanity perks ($9.99/mo):

- Free username/handle change
- Verification check after AI review
- Full profile + avatar customization

### 4.7 Safe spaces & filters

- Dedicated spaces by gender identity and sexual orientation
- Kink/fetish taxonomy with **opt-in filters** (next-level granularity)
- User-controlled content warnings and mute lists
- Community rules exportable; moderators scoped

### 4.8 Mental health

Persistent footer + settings + after-session prompts:

- Links to IASP, local crisis lines, and adult-content addiction resources
- Soft friction when engagement scores spike into “too far” patterns
- Never moralize; always offer exit ramps and human support agent

---

## 5. DroolRank — revolutionary algorithm (design)

Goals: **euphoric discovery** without rage-farming; **consent-aware**; **explainable**.

Signals (weighted, versioned):

1. **Affinity** — mutual graph, safe-space membership, stated interests/kinks
2. **Consent fit** — content labels ∩ user mode (NSFW/SFW) ∩ filter prefs
3. **Quality** — dwell, completion, rewatch, positive replies (not raw outrage)
4. **Creator care** — diversity of sources; anti-monopoly rotation
5. **Safety penalty** — reports, harassment graph distance, hate classifiers
6. **Freshness + session energy** — soft boosts for new creators; cooldown on doomscroll loops
7. **Points integrity** — engagement that only farms points without quality is downranked

Every For You card exposes **“Why am I seeing this?”** with the top 3 signals.

No dark pattern that forces NSFW. SFW mode is a first-class feed, not a broken subset.

---

## 6. Moderation — 24/7 autonomous

Stack:

1. **Client personal controls** (block/mute/filter) — instant
2. **AI triage** (Mythic agents) — labels, CSAM hash checks, hate/harassment classifiers
3. **Auto-resolve** for clear policy hits with appeal path
4. **Human escalation** — last resort only
5. **Support user-agent** — always-on help for reports, bans, mental health routing

Policy pillars:

- Free expression of **consensual adult** content and speech
- No hate, bullying, bigotry, harassment, doxxing
- No CSAM / non-consensual intimate imagery / trafficking
- Transparent reasons + appeal

---

## 7. AI org (Droolhouse)

Paperclip company with Mythic (`hermes_local`) employees:

| Agent | Role |
|-------|------|
| **CEO / Operator** | Goals, capital, product priorities |
| **Moderation Lead** | Policy, auto-resolve queue, escalations |
| **Support Agent** | User-facing support “user” agent |
| **Growth** | Campaigns, creator onboarding |
| **Engineering** | Ship DroolNet + web/mobile |
| **Companion Curator** | Sexbot personas, safety evals |
| **Economy** | Points ≤ ad rev; `$DROOL` mint readiness |
| **Trust & Safety Legal** | Age, jurisdiction, notice/takedown |

See `paperclip/droolhouse/` for importable org chart and agent configs.

---

## 8. Implementation inheritance

This repo is the former WokeSocial monorepo, rebranded. All WokeSocial expansion workstreams (video, names, points, avatars, verification, AI, governance) are **adopted and redirected** to WetDrool adult-product semantics above.

Evidence policy from `PRODUCT_SPEC.md` still applies: **Planned ≠ shipped**.
EOF