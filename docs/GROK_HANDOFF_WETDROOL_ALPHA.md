# Grok AI handoff — WetDrool wallet alpha

## Start here

Read, in order:

1. Repository root AGENTS.md.
2. apps/wallet-alpha/AGENTS.md.
3. docs/DECISIONS/0013-wokenet-alpha-wallet-entry-boundary.md.
4. docs/WOKENET_ALPHA.md.
5. apps/wallet-alpha/README.md.

Work from a clean checkout or isolated branch. Do not develop from the dirty
wetdrool-web main worktree. The current alpha branch is
codex/wetdrool-wokenet-alpha.

## Definition of done for this alpha

- The static verifier and protocol unit tests pass.
- A real injected Solana wallet can connect, sign readable text, verify locally,
  derive the vault key, seal a note, sign the manifest, reload local records, export,
  import, and reject a tampered bundle.
- The wallet is never asked for a transaction.
- Profile name and pronouns decrypt only after wallet unlock.
- All, Straight, and Pride modes rank only synthetic non-explicit fixtures and make
  no network request.
- The founder preview renders at /kingofqueens6ix.
- Mobile and desktop visual QA has no overflow or inaccessible interaction.
- The production site exposes its limitations in both visible copy and the well-known
  status file.

## Current intentional gaps

- No standardized Wallet Standard package or Solana Mobile Wallet Adapter.
- No one-use server nonce or HttpOnly wallet session.
- No device delegation key.
- No CAR packaging.
- No peer discovery, relay, DHT, WebRTC, QUIC, WebTransport, or onion routing.
- No public user write.
- No adult content, external feed, upload, message, subscription, payment, tip, or
  active token integration.
- No legal age assurance.
- No production multi-device E2EE, revocation, recovery, or external audit.

These are gaps to resolve through reviewed milestones, not labels to hide with copy.

## Do not do

Do not weaken CSP, add CDN scripts, invent token addresses, fetch random adult media,
claim anonymity, store secrets in the repository, or convert the static alpha into a
public adult platform without the required verified controls. Do not use the founder
photo outside its approved profile route without explicit owner direction.

## Product family (do not merge)

Keep these as **sibling products**, not one codebase or one login:

| Surface | Repo | Job |
| ------- | ---- | --- |
| **WetDrool** (`wetdrool.com`) | `wetdrool-web` → `apps/wallet-alpha` | 18+ creator / protocol alpha (this handoff) |
| **ICEFAM.FM** | `icefam-fm-web` | Web3 radio + culture / release beta |
| **DROOLY.AI** | `drooly-web` (+ Icefam holder chat) | Intelligence / chat platform |

Footer links between them are discovery only. Do not share wallet sessions, adult
feeds, or brand assets across those origins.

## Immediate engineering queue

1. Run the alpha unit/static checks.
2. Serve over loopback and run responsive browser QA.
3. Fix discovered visual and functional defects only inside apps/wallet-alpha.
4. Deploy the standalone Vercel project under Mythic Agent (not Icefam / Drooly projects).
5. Smoke test every public asset and status.
6. Update this handoff with exact deployment URL and evidence.
7. Wait for the exact `$WET` mint before changing token configuration.
8. Attach `wetdrool.com` DNS only after production smoke tests pass.
