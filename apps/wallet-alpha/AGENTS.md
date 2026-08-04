# AGENTS.md — WetDrool wallet alpha

This file governs work inside apps/wallet-alpha. Also follow the repository root
AGENTS.md. When the two differ, preserve the root protocol, naming, security, and
honest-status rules.

## Objective

Finish and harden the isolated wetdrool.com wallet-entry alpha without exposing the
large dirty legacy worktree or pretending future infrastructure already exists.

Product vocabulary:

- WetDrool is the application and creator product.
- DroolNet is WetDrool portable object and Solana application protocol.
- WOKE.NET is the future replaceable carrier, peer sync, and independent availability
  research layer.
- Solana is the phase-one wallet identity and possible future settlement adapter.

Do not rename existing serialized protocol namespaces. Do not call WOKE.NET a chain,
onion network, anonymity service, or deployed mesh.

## Approved identity

- Canonical wordmark: assets/wetdrool-wordmark.png
- Wordmark SHA-256:
  189edfc19f0dc276dfff2a34d7da4597ee9f45c93144431dfb9fc8b74223fead
- Compact mark: assets/wetdrool-mark.svg
- Visual language: pure black, white, spectral cyan/blue/violet/magenta/amber, soft
  glass surfaces, rounded system typography, sensual but non-explicit.
- Do not substitute a prior no-eye logo. The approved mark contains the eye inside
  the heart/droplet vessel.

Founder profile:

- Route: /kingofqueens6ix/
- Public display: Alex Droolhouse
- Handle: @kingofqueens6ix
- Explicit owner-approved detail string: 24M · it/its · freak
- Approved PFP: assets/kingofqueens6ix-pfp.jpg
- PFP SHA-256:
  bf473aea87ecfdd21bf6a745fed84c1a8b90097f2b446248b9522a555fba3f85

Do not infer or add legal name, transition status, medical information, sexuality,
location, or other identity details. Pronouns and discovery modes are always chosen,
optional, and never inferred.

## Implemented alpha

- Self-contained static HTML, CSS, and JavaScript.
- No third-party scripts, styles, images, analytics, or API calls.
- Injected Solana wallet detection.
- Readable local message signature only.
- Browser Ed25519 signature verification without RPC.
- HKDF-SHA256 wallet-derived, non-extractable AES-256-GCM key.
- Encrypted IndexedDB records.
- CIDv1 raw SHA-256 identifiers over encrypted object bytes.
- Wallet-signed local manifests.
- Verified JSON export/import.
- Offline service-worker application shell.
- Encrypted local display-name and pronoun profile.
- Local All, Straight, and Pride discovery modes.
- Synthetic non-explicit discovery cards with a real local ranking function.
- Machine status at /.well-known/wokenet-alpha.json.
- Founder profile preview at /kingofqueens6ix/.

The wallet proof is entirely client-side. It is not a production Sign In With Solana
server session and it cannot protect public static assets from direct retrieval.

## Hard safety and truth boundaries

Never:

- Request a transaction, token approval, seed phrase, private key, or wallet payment
  during entry.
- Treat a wallet as age assurance, legal identity, personhood, gender, consent, or
  anonymity.
- Add adult media, uploads, public posts, DMs, live streams, subscriptions, tips, or
  settlement to this alpha.
- Fetch or embed a random adult-content API.
- Claim performer age, consent, licensing, or provenance without linked verified
  records and operator controls.
- Claim E2EE merely because browser-local AES-GCM exists.
- Claim decentralized availability before independent peers, multiple failure
  domains, and a primary-host outage drill pass.
- Put IDs, selfies used for verification, biometric templates, legal identity,
  performer records, consent evidence, or moderation evidence on a public chain.
- Use AI as the sole authority for age ambiguity, consent disputes, coercion,
  trafficking, suspected CSAM, NCII appeals, reporting, or irreversible action.
- Invent the $WET contract address.

Future real adult publication requires independent qualified review plus operational
age/performer records, content-specific consent, reporting, takedown, trafficking,
NCII, audit, human escalation, appeal, and payment/crypto compliance boundaries.

## Discovery modes

All, Straight, and Pride are explicit user controls. Pride emphasizes trans, femboy,
and queer creators. The current feed uses abstract synthetic fixtures only.

Ranking weights:

- 35 percent provenance readiness.
- 20 percent recency.
- 20 percent novelty.
- 10 percent engagement capped at 0.75.
- 15 percent explicit mode match.

Do not infer a mode from viewing behavior. Do not transmit it. Any future provider
adapter must accept a locally constructed bounded query, return signed/licensed
manifests, and keep external tracking blocked by default.

## $WET boundary

config.js is the sole alpha configuration source:

    window.WETDROOL_ALPHA = {
      WET_SYMBOL: "$WET",
      WET_CA: "",
      WET_TRADE_URL: "",
      WET_STATUS: "mint-pending"
    }

Only update WET_CA after the owner pastes the exact Solana mint. Verify the mint and
trade URL independently, then update config.js, the well-known status file, visible
copy, tests, and operational documentation together. Wallet entry remains free and
non-gating unless a separately reviewed decision changes it.

## Files

- index.html: wallet entry, local node, discovery lab, honest status.
- styles.css: primary app system.
- app.js: DOM, wallet integration, local records, discovery, profile.
- protocol.js: canonical alpha JSON, base encodings, CID, crypto envelopes.
- vault.js: IndexedDB adapter.
- profile.css and kingofqueens6ix/index.html: founder preview.
- config.js: staged $WET configuration.
- service-worker.js: same-origin offline shell.
- vercel.json: CSP and security headers.
- .well-known/wokenet-alpha.json: machine-readable truth boundary.
- scripts/verify.mjs and tests/: bounded release checks.
- docs/WOKENET_ALPHA.md and ADR 0013: architecture authority.

## Verification

From the repository root:

    node --test apps/wallet-alpha/tests/*.test.mjs
    node apps/wallet-alpha/scripts/verify.mjs
    git diff --check

Serve locally:

    python3 -m http.server 8080 --directory apps/wallet-alpha

Browser QA must cover:

- 390 by 844 mobile, 768 tablet, and 1440 desktop.
- Zero horizontal overflow.
- Keyboard focus and Escape behavior for the wallet guide.
- Wallet absent, rejected, malformed signature, locked, and successful states.
- Encrypted object create, reload, export, import, tamper rejection, and wrong-wallet
  decryption failure.
- All, Straight, and Pride mode changes.
- Offline reload after one successful secure-context load.
- /kingofqueens6ix profile and image cropping.
- CSP has no unsafe-inline and no third-party resource load.

## Deployment

Deploy apps/wallet-alpha as its own Vercel project under the Mythic Agent team.
Do not reuse Icefam FM, Drooly AI, or Continuity Bureau projects. The first deployment
may use a Vercel alias. Attach wetdrool.com only after the owner adds the exact DNS
records and a production smoke test passes.

Verify after deploy:

- Homepage and /kingofqueens6ix return 200.
- /.well-known/wokenet-alpha.json returns JSON and the honest false statuses.
- Wordmark, PFP, service worker, manifest, robots, and CSP return correctly.
- No production environment secret is required by this static alpha.

## Handoff priority

1. Preserve the truth boundary and pass existing tests.
2. Fix functional or responsive issues discovered by browser QA.
3. Add a Wallet Standard/Mobile Wallet Adapter integration without third-party CDN
   scripts.
4. Replace per-object wallet prompts with an expiring wallet-authorized local device
   key after a protocol ADR and adversarial tests.
5. Package a signed application manifest and CAR.
6. Build bounded read-only carriers and independent failure-domain tests.
7. Keep adult publication and settlement blocked until the operational controls are
   reviewed and present.

Record any material production, identity, provider, token, safety, or publication
decision in docs/obsidian while making the change.
