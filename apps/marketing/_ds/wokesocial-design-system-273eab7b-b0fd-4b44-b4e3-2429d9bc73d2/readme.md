# WetDrool Design System

The design system for **WetDrool** (`wetdrool.com`) — an inclusive, LGBTQ+ affirming, trans-owned social platform, and **DroolNet**, its protocol and smart-contract layer on Solana.

> **Own your voice. Choose your horizon.**

---

## 1. Product context

WetDrool is a mass-market social product first and a decentralised product second. People publish text, images and video; follow people, creators, communities and interests; join and moderate communities; search, message, attend events, and control their identity, privacy and feed. DroolNet sits underneath as the protocol layer — **not** a blockchain, validator network, RPC network or Solana fork. Solana supplies the external ledger.

Three rules shape almost every decision in this system:

1. **A person must be able to use every screen without knowing what a wallet is.** Wallet connection is optional wherever product requirements allow it, and technical evidence (hashes, signatures, slots, provider URLs) lives behind an optional disclosure — never in a primary flow.
2. **Nothing claims to be confirmed until it is confirmed.** "Waiting for confirmation" is a first-class state with its own colour, copy and icon.
3. **Inclusion is functionality, not decoration.** Chosen names, multiple pronoun sets with per-audience visibility, deadnaming protections, private safety actions, appeals, and anti-dogpiling controls — no permanent rainbow overlay.

There is **no `$DROOL` mint**. The name is reserved for a possible future SPL asset. SOL and lamports are not `$DROOL`, and no token sale, bridge, yield or token-gated feature is authorised. Never write copy that implies otherwise.

### Products covered

| Surface | Where it lives | UI kit |
|---|---|---|
| Public marketing site (`wetdrool.com`) | `droolnet/apps/web/app/page.tsx` + `styles/marketing.css` | `ui_kits/marketing/` |
| Web product (feed, composer, profile, safety, settings) | `droolnet/apps/web/app/*` + `styles/{shell,application,product,extended-product}.css` | `ui_kits/web-app/` |
| WetDrool for Seeker (Android) | `droolnet/apps/mobile` (Expo, non-release foundation) | `ui_kits/seeker/` |

`droolhouse.com` is redirect-only. Always write the destination as **wetdrool.com**.

### Sources used to build this system

- **Codebase:** `droolnet/` monorepo, mounted read-only. Key files read:
  `docs/BRAND.md`, `docs/PRODUCT_SPEC.md`, `packages/ui/src/styles.css` (the previous token set and component CSS), `packages/ui/src/*.tsx`, `apps/web/app/globals.css`, `apps/web/styles/{shell,application,product}.css`, `apps/web/components/{site-header,post-card,mobile-dock,composer}.tsx`, `apps/web/app/page.tsx`, `apps/mobile/src/**`.
- **Brand artwork supplied by the client:** `uploads/light-grey-{no-text,text}-{black,trans}.svg|png`, `uploads/banner.svg` — copied into `assets/logo/`.
- **Colour direction supplied by the client:** `#cff0ec`, dark grey / black / slate, accent `linear-gradient(90deg, #8c52ff, #ff914d)`.

### Relationship to the palette already in the codebase

`packages/ui/src/styles.css` ships an earlier palette — warm paper `#f8f5ef`, plum `#5f2c83`, coral `#ed6a5a`, citron `#d7f171`. **This system supersedes it**, because the supplied `$DROOL` artwork is mint on near-black and the client specified the mint/slate/violet-ember direction directly. The structural decisions from that file are kept verbatim: the spacing steps, the radius scale, the `cubic-bezier(0.2, 0.8, 0.2, 1)` standard easing, the 140/220ms durations, the three-theme model (light / dark / high-contrast), and the "every component has a designed loading, empty, error, offline, stale, sensitive, blocked, pending and confirmed state" requirement.

Token names changed from `--wetdrool-*` to `--ws-*`. Rough mapping for anyone porting the app:

| Old | New |
|---|---|
| `--wetdrool-canvas` | `--ws-surface-canvas` |
| `--wetdrool-canvas-raised` / `--surface-strong` | `--ws-surface-raised` / `--ws-surface-card` |
| `--wetdrool-ink` / `--ink-muted` | `--ws-text-primary` / `--ws-text-secondary` |
| `--wetdrool-line` / `--line-strong` | `--ws-border-default` / `--ws-border-strong` |
| `--wetdrool-plum` (brand action) | `--ws-brand-primary` |
| `--wetdrool-coral` / `--citron` (accents) | `--ws-accent-ember` / `--ws-accent-violet` |
| `--wetdrool-radius-*`, `--space-*`, `--duration-*`, `--ease` | `--ws-radius-*`, `--ws-space-*`, `--ws-duration-*`, `--ws-ease-standard` |

---

## 2. CONTENT FUNDAMENTALS

The voice is **plainspoken, warm, and precise** — and it gets quieter as the stakes rise. It is drawn from `docs/BRAND.md` and the copy already in `apps/web`.

### Who speaks, and how

- **Second person for the user, first-person plural only when WetDrool is acting or accountable.** "Your draft is saved on this device." / "We ask you before every publication that uses a permanent store." Never "we" for things the user did.
- **Sentence case everywhere.** The only uppercase style is the eyebrow, capped at four words. No Title Case Buttons.
- **Contractions are fine, and preferred** — "You're offline", "They aren't notified", "It doesn't prove the claims inside it."
- **No emoji.** The brand carries no emoji; the interface never uses one as a label, status or decoration. Users' own posts are their business.
- **No exclamation marks in system copy.** Warmth comes from word choice, not punctuation.
- **British-leaning spelling in product copy** ("organising", "honours", "favourite") — matches the existing repo copy.

### Rules that are non-negotiable

| Rule | Instead of | Write |
|---|---|---|
| Describe the outcome, not the infrastructure | "Submit transaction" | "Post" |
| Never promise erasure you can't deliver | "Deleted forever" | "Removed from WetDrool. Copies already published to a permanent store can't be recalled." |
| Never confirm early | "Posted!" | "Waiting for confirmation" → "Verified" |
| Never expose protocol jargon | "Select a decentralized backend" | "Choose where copies are stored" |
| Never blame the user for a system failure | "You entered an invalid endpoint" | "That address didn't respond. Your previous provider is still working." |
| Errors say what is still safe | "Something went wrong" | "Your post is saved on this device and will retry when the network returns." |
| Never infer identity | "People like you" | "Because you follow Disability Justice Now" |
| Safety actions state their privacy | "Blocked" | "Blocked. They aren't told." |

### When the brand is playful, and when it stops

**Playful** — onboarding, empty states, interest picking, community discovery, celebration after a first post. Dry, specific, human: *"Nothing is trending. WetDrool does not rank conversations by how angry they are."*

**Quiet and serious** — anything about safety, harassment, moderation, appeals, account recovery, deletion, permanence, encryption, money or failure. In these surfaces: short sentences, no jokes, no metaphor, no reassurance the system can't back up, and always a next step.

### Example copy

| Moment | Copy |
|---|---|
| Welcome | "Own your voice. Choose your crowd. Keep the keys." |
| Onboarding | "Pick what you want more of. These choices only shape your feed. They are never used for advertising, and they are never inferred from what you read." |
| Empty feed | "Your feed is quiet right now. Follow a few people or join a community and it fills up. Nothing is hidden — there just isn't much yet." |
| Composer placeholder | "What's happening in your world?" |
| Composer, offline | "Saved on this device. It'll post when you're back online." |
| Account privacy | "We never ask for a legal name. Gender, sexuality and disability fields are optional, private by default, and excluded from recommendations and analytics." |
| Content warning | "Anti-trans legislation — discussion of a bill currently in committee, including quoted language from it." + "Show anyway" |
| Report confirmation | "Report sent. It goes to the moderators of Old Games Club first. If it breaks WetDrool's standards it comes to us as well. You can withdraw it from your safety log at any time." |
| Moderation decision | "Your post was limited to members. A moderator applied the community's rule on linking to storefronts. It's still on your profile and still visible to your followers. It does not affect your account standing." |
| Appeal | "A person reviews every appeal. Most are answered within two days." |
| Offline mode | "You're offline. Your draft is saved on this device and will post itself when the network returns." |
| Wallet connection | "You only need this to claim a handle. Everything else on WetDrool works without it." |
| Pending confirmation | "Not confirmed yet. This usually takes a few seconds — you can leave this screen and we'll tell you when it's done." |
| Failed transaction | "We couldn't confirm that. Nothing has changed, and your post is still saved on this device. Try again?" |
| Successful verification | "Verified. This post hasn't changed since it was signed." |
| Notification permission | "Want a heads-up when someone replies? We batch notifications a few times a day by default, and you can change that any time. You can also say no and nothing breaks." |
| Destructive account action | "Delete your account? Your posts, follows and communities go with it. Signed public copies that other people or services already hold can't be recalled — we can't promise otherwise. This can't be undone." |

---

## 3. VISUAL FOUNDATIONS

### The idea

Editorial confidence over product surfaces that stay quiet. Feeds, safety controls and publishing are calm and predictable; character comes from the display serif, the mint, and one gradient used sparingly. The `$DROOL` mark — a hand-drawn all-seeing eye with rays — is the only illustration in the system, and it is never redrawn.

### Colour

- **Foundation:** cool slate. Canvas `#0e1315`, cards `#171d1f`, text `#f3f6f6` / `#aeb8ba` / `#828d90`. **Dark is the default theme** — the mark is mint on near-black and mint only reads as luminous against ink. Light and high contrast are opt-in via `data-theme` on `<html>` and are equally specified, not filters.
- **Brand:** mint `#cff0ec` — the exact colour of the supplied artwork. In dark it is the primary action fill with ink labels; in light the primary action inverts to ink `#171d1f` with mint labels.
- **Accents:** violet `#8c52ff` and ember `#ff914d`, the two ends of the signal gradient. Each has a lighter text-safe step (`#a87eff`, `#ff914d` on dark; `#6023cd`, `#ab4409` on light).
- **The signal gradient** `linear-gradient(90deg, #8c52ff, #ff914d)` — one angle, one job. Allowed on: one CTA per view, progress fill, selection rules, a 3px card edge. Never on: page backgrounds, cards, text at body size, or anything behind reading content. Labels on the gradient are always ink — white fails on the ember end.
- **Semantics:** success / warning / danger / info / moderation, each with a text colour, a 12%-alpha surface and a 36%-alpha border. Every state pairs colour with a word and an icon. There is no colour-only communication anywhere in the system.
- Full ramps: `tokens/palette.css`. Semantic aliases and all three themes: `tokens/themes.css`.

### Type

Three families plus a mono. `tokens/fonts.css`, `tokens/typography.css`.

- **Display / title / post — Source Serif 4.** Headlines are tight (−0.05em, sub-1.0 leading, weight 650). **Post bodies are set in the serif at 19px/1.5 on a 46ch measure** — this is the single biggest reason a WetDrool feed does not look like every other timeline.
- **UI / body — Nunito Sans.** Body 16/1.6; long reading capped at 68ch. Interface weights run heavy (700–800) because the sans is doing structural work next to a serif.
- **Brand text — Comic Sans MS** (`--ws-font-brand`, fallback Comic Neue). The header wordmark and the `$DROOL` lockup only. It is the face the supplied artwork is drawn from, and it is the reason WetDrool reads as friendly rather than institutional at first glance. **Never for UI, body, headings or long-form text** — the moment it appears outside brand text, the system stops looking deliberate.
- **Mono — JetBrains Mono**, provenance and developer surfaces only.
- **Floors:** 14px for body text, 13px for metadata, 12px for the eyebrow (the only uppercase style). Nothing smaller ships.
- `text-wrap: balance` on display headings, `text-wrap: pretty` on prose and post bodies.

### Layout and space

4px base. Steps 1–7 (`4 8 12 16 24 32 48`) are the codebase's exact values; 8–10 (`72 96 128`) extend them. Feed column is **640px at every window size** — it never stretches. Reading prose caps at 720px; the app shell at 1216px; marketing at 1440px. Window classes follow the Android adaptive model: compact `<600` (bottom dock + FAB), medium `600–904` (88px icon rail), expanded `905–1239` (272px labelled rail + aside), large `1240+` (three panes). Panes change — layouts don't merely resize.

Fixed chrome always adds `env(safe-area-inset-*)`, and `scroll-padding-top` offsets the app bar so focus is never hidden behind sticky UI.

### Shape, borders, depth

- Radius: `8 / 12 / 20 / 32 / 999 / 16(media)`. Radius scales with container size, never with importance. **Pill is only for controls carrying a text label** — buttons, chips, tabs, search. Never on a content container.
- **Hairlines do the structural work.** Cards are a 1px border on a slightly raised fill, flat by default. Elevation has four levels and is reserved for things that genuinely float over content the user was reading: FAB (1), sheets/toasts/menus (2), dialogs (3).
- **Backgrounds are flat.** No page gradients, no mesh, no noise, no texture, no illustration wallpaper. The codebase's dotted-grid body overlay is deliberately dropped — it competed with feed text.
- Media gets a 16px frame with a hairline; video and story chrome sit on a bottom scrim (`rgba(8,11,12,.78) → transparent`) so captions stay legible.
- **Blur is for chrome only** — app bar, bottom dock, floating controls, at `blur(18px) saturate(125%)`. Never behind reading content, and swapped for an opaque surface under `prefers-reduced-transparency`.

### Interaction states

| State | Treatment |
|---|---|
| Hover | Lighter fill (`--ws-state-hover-overlay`, 7% mint) or a 2px lift on buttons. Pointer only — hover is never required to understand anything. |
| Focus | One indicator everywhere: 3px `--ws-focus-ring` outline, 3px offset, plus a halo ring so it stays visible on mint, on media and on the gradient. |
| Pressed | `scale(0.975)`. WetDrool presses shrink; they never bounce, ripple or overshoot. |
| Selected | Mint tint + border + `aria-pressed`/`aria-selected`, and selected chips lead with a check. |
| Disabled | 45% opacity, `cursor: not-allowed`; links get `aria-disabled` rather than removal. |
| Loading | Spinner replaces the leading icon, label stays, `aria-busy="true"`. |

### Motion

120–240ms for anything the user triggered; 320ms for full-screen navigation; 480ms only for narrative moments (story advance, publish confirmation). Easing: standard `cubic-bezier(.2,.8,.2,1)`, entrance `(.05,.7,.1,1)`, exit `(.3,0,.8,.15)`, emphasized `(.2,0,0,1)`. Nothing loops indefinitely except a spinner that has a matching status line. `prefers-reduced-motion` collapses every duration to 1ms and replaces movement with an instant state change — never with nothing. Haptics (Android/Seeker) map to `CONTEXT_CLICK` / `CONFIRM` / `REJECT` / `LONG_PRESS`.

### Imagery, avatars, illustration

- **No stock photography and no AI-generated people.** The repository is explicit: original artwork or licensed imagery only. UI kits use honest placeholders labelled as such rather than borrowed images.
- Photography direction when real imagery arrives: available light, warm-neutral grade, no heavy filters, no grain overlay, people doing something rather than posing. Represent varied bodies, races, ages, abilities, gender expressions and family structures — as a baseline, not as a campaign.
- **Default avatars are a soft asymmetric blob with a chosen-name initial**, tinted from one of six deterministic colours hashed off the account id. Deliberately not a circle, and deliberately not a human silhouette — generic silhouettes carry a default body, gender and race, and WetDrool's default carries none. Community avatars are square so a community is never mistaken for a person.
- The signal-gradient ring on an avatar means **unseen story** and nothing else — never status, never verification.
- Sensitive media is covered, never blurred-and-legible: a labelled cover states the warning and offers "Show anyway". Reposting inherits the warning.
- AI-generated media carries a visible "Made with AI" chip on the media frame and in the post's accessible description.

### What this system does not do

No aggressive gradients or mesh backgrounds. No glassmorphism behind content. No rainbow-washing. No blob illustrations. No neon purple as a default. No engagement counters shouting. No dense dashboard chrome. No tiny grey text. No infinite animation, streaks, or shame-based re-engagement.

---

## 4. ICONOGRAPHY

**The droolnet codebase ships no icon system.** It draws its few symbols with CSS geometry (`.wetdrool-brand__symbol`, `.wetdrool-status__dot`, `.wetdrool-state-panel__signal`) and uses single letters as glyphs in the mobile dock (`{ glyph: 'H', href: '/home' }`) — an acknowledged placeholder, not a design. There is no icon font, no SVG sprite, no PNG icon set, and no emoji anywhere in the repository.

**Substitution — please confirm.** This system substitutes **Lucide** (`https://unpkg.com/lucide@0.462.0/dist/umd/lucide.js`), loaded from CDN and wrapped by the `Icon` component. Lucide was chosen because its 2px round-cap, round-join strokes are the closest available match to the hand-drawn `$DROOL` mark, which is built entirely from rounded strokes. If WetDrool commissions its own set, `components/icon/Icon.jsx` is the only file that has to change.

Rules:

- **Optical sizes:** 16 (inline with 14px text, stroke 2.25), 20 (default — buttons, list rows), 24 (app bars, bottom nav), 32+ (state panels and empty states). Never scale a glyph to an in-between size.
- **Stroke stays 2px** at every size except 16px. Icons are never filled, except the active state of a reaction control, where the fill is the state change.
- **Icons are decorative by default** (`aria-hidden`). The accessible name belongs to the control: `IconButton` requires a `label` prop, and that label is also the tooltip.
- **Never icon-only navigation with hidden labels.** The bottom dock and the expanded rail always show text. The 88px medium rail is the one icon-only case, and every item there carries an `aria-label` and a native tooltip.
- **Never emoji, never unicode characters as icons.** `↵ ♥ ✓` are not icons; use `Icon`.
- **Badging:** counts cap at "9+", sit on the glyph, and never carry meaning alone.
- **Never hand-draw an SVG** for a UI glyph. The only bespoke artwork in the system is the `$DROOL` mark in `assets/logo/`.

---

## 5. Index

### Root

| File | What it is |
|---|---|
| `styles.css` | The single stylesheet consumers link. `@import` list only. |
| `thumbnail.html` | Homepage tile for this design system. |
| `readme.md` | This document. |
| `SKILL.md` | Agent-skill front matter for use in Claude Code. |

### Tokens — `tokens/`

`fonts.css` (webfont loading + family stacks) · `palette.css` (primitives) · `typography.css` (the full scale) · `spacing.css` (4px scale, density, touch targets) · `shape.css` (radius, borders, elevation, scrims, blur) · `motion.css` (durations, easing, press, haptics) · `layout.css` (breakpoints, content widths, safe areas, z-index) · `themes.css` (semantic tokens for dark / light / high contrast) · `base.css` (element defaults, focus, reduced motion & transparency).

### Assets — `assets/logo/`

`woke-mark.svg` (eye mark, mint — dark theme) · `woke-mark-ink.svg` (light theme) · `woke-mark-white.svg` (high contrast) · `woke-mark-on-ink.svg` · `woke-lockup.svg` (mark + `$DROOL`) · `woke-lockup-ink.svg` · `woke-lockup-on-ink.png` · `woke-banner.svg` (1500×500 banner).

The ink and white files are the *same supplied drawing* with its single `fill="#cff0ec"` swapped — the geometry is untouched. `BrandMark` renders all three and CSS shows the one that matches the theme, so the mark is never filtered, tinted or distorted.

### Components — `components/`

36 components in nine groups. Each has `Name.jsx`, `Name.d.ts` (props + accessibility contract), `Name.prompt.md` (usage), and one `@dsCard` HTML per group.

| Group | Components |
|---|---|
| `icon/` | **Icon** |
| `brand/` | **BrandMark**, **Eyebrow** |
| `actions/` | **Button**, **IconButton**, **Fab** |
| `forms/` | **Field**, **SearchField**, **Checkbox**, **Switch**, **Select** |
| `display/` | **Avatar**, **StatusBadge**, **Chip**, **Card**, **SectionHeading**, **Skeleton** |
| `navigation/` | **Tabs**, **MobileDock**, **NavRail**, **ThemePicker** |
| `feedback/` | **StatePanel**, **Banner**, **Toast**, **ProgressBar**, **Dialog** |
| `social/` | **PostCard**, **ReactionBar**, **CommunityCard**, **EventCard**, **NotificationRow**, **ComposerBar** |
| `trust/` | **VerificationDetail**, **TransactionStatus**, **WalletConnectCard**, **ProviderHealthNotice** |

Directly ported from `@wetdrool/ui`: **BrandMark**, **Eyebrow** (`.wetdrool-eyebrow` / `.section-kicker`), **SectionHeading**, **StatusBadge**, **StatePanel**, **ProviderHealthNotice** (was `ProviderCard`), **Card** (was `InfoCard`), **Button** (was `ButtonLink`).

Ported from `apps/web/components`: **PostCard**, **ComposerBar**, **CommunityCard**, **Tabs** (`feed-tabs`), **MobileDock**, **ThemePicker**, **Banner** (`connectivity-notice`), **Skeleton** (`skeleton-composer`), **VerificationDetail** (`proof-details`), **Field**/**Select**/**Checkbox**/**Switch** (`field-stack`, `local-preference-editor`), **SearchField** (`search-bar`), **Avatar** (`post-card__avatar`).

#### Intentional additions

Not in the source, but required by screens the source specifies:

| Component | Why |
|---|---|
| **Icon** | The codebase has no glyph set; a wrapper is needed so the substitution lives in one file. |
| **IconButton**, **Fab** | Compose and overflow actions on compact windows; the mobile dock's `+` needs a real control. |
| **Chip** | Interest picking, feed filters and community tags across explore, composer and safety. |
| **NavRail** | Medium and expanded window classes are required by the responsive strategy; the repo only had a header and a dock. |
| **Dialog**, **Toast** | Destructive confirmations and undo are named requirements in `PRODUCT_SPEC.md` with no implementation to port. |
| **ProgressBar** | Staged publication progress (signing → saving → confirming → indexed). |
| **ReactionBar** | Engagement controls; `post-card.tsx` renders "Interactions require SDK wiring" instead. |
| **EventCard**, **NotificationRow** | Events and notifications are product surfaces in the spec with routes but no component. |
| **TransactionStatus**, **WalletConnectCard** | The whole wallet state matrix is specified in `PRODUCT_SPEC.md` §5.2 and unimplemented. |

### UI kits — `ui_kits/`

| Kit | Screens |
|---|---|
| `web-app/` | Home feed · Explore & communities · Post detail with provenance · Profile · Safety centre (block/mute/restrict/report/appeal) · Settings (feed, identity, providers, wallet) |
| `marketing/` | The `wetdrool.com` landing page |
| `seeker/` | Home feed · Composer + audience sheet · Wallet & confirmation · Notifications · Vertical video |
| `prototype/` | **Product-vision prototype** (supplied in chat, beyond the codebase spec): points economy with live balance, .drool handles tied to Solana wallets, custom-handle claiming, avatar studio + creator marketplace, Drool AI (Athena / Kairos / Hermes, points as credits), shorts/long video with middle-out compression, sentiment trading bots (paper-mode default), Woke Plus subscription + zero-retention E2EE verification, Pinkman, Inc. corporate structure |

`ui_kits/_boot.js` resolves the compiled bundle, falling back to in-browser transpilation of the component sources when `_ds_bundle.js` has not been generated yet.

### Guidelines — `guidelines/`

25 specimen cards feeding the Design System tab: `brand/` (lockups, clear space & misuse, app icon, signal gradient) · `colors/` (mint, slate, accents, three themes, status, contrast pairs) · `type/` (display, post voice, body, labels, mono, full scale) · `spacing/` (scale, in use, touch targets) · `layout/` (window classes, content widths) · `shape/` (radius, elevation, borders) · `motion/` (durations, principles).

---

## 6. Accessibility contract

WCAG 2.2 AA is the floor, and it is documented per component in each `.d.ts` rather than in an appendix. System-wide:

- 4.5:1 for body text, 3:1 for large text and meaningful non-text. Measured pairs are in `guidelines/colors/contrast-pairs.card.html`.
- One focus indicator everywhere, with a halo so it survives any background; `scroll-padding-top` keeps it clear of sticky chrome.
- 48px minimum touch targets on every platform. 36px controls are legal only inside a ≥48px row.
- Full keyboard operation; logical focus order; focus returns to the trigger when a dialog closes.
- No colour-only communication anywhere. Every status carries a word and an icon.
- Reduced motion, reduced transparency, high-contrast theme, and text zoom to 200% with reflow.
- Every icon-only control has an accessible name via `IconButton`'s required `label`.
- Errors describe the fix, appear before help text in the DOM, and pair with a form-level summary on submit.
- Media: captions on by default in the vertical viewer, sound off until asked, playback pausable, alt text a first-class composer control with an `ALT` / `NO ALT` marker on every image.

---

## 7. Open questions for the client

1. **Fonts.** Brand text is **Comic Sans MS**, confirmed and now **self-hosted** from the client's uploaded `fonts/ComicSansMS3.ttf` (declared in `tokens/fonts.css`; an installed local copy is preferred when present). Separately, the codebase specifies **Avenir Next** (UI) and **Iowan Old Style** (display) — licensed desktop faces with no webfont binaries in the repo; this system substitutes **Nunito Sans** and **Source Serif 4** from Google Fonts. Please send licensed WOFF2 files for those two, or confirm the substitutes.
2. **Icons.** Lucide is a substitution (see §4). Confirm, or commission a set.
3. **Photography and illustration.** None exists yet. UI kits use labelled placeholders. Art direction is proposed in §3 and needs approval before any imagery is commissioned.
4. **The `$DROOL` wordmark.** The supplied artwork reads `$DROOL`, while the product name is **WetDrool**. Confirm the intended relationship — is `$DROOL` the mark for the token/protocol and `WetDrool` the product wordmark, or is `$DROOL` the primary mark everywhere?
