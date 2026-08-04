# ADR 0013: WOKE.NET alpha wallet-entry boundary

- Status: accepted for isolated alpha
- Date: 2026-08-04
- Scope: apps/wallet-alpha only

## Context

The owner wants WetDrool to be the first application experience associated with
WOKE.NET: wallet-native, local-first, content-addressed, resilient, and ultimately
usable beyond one web host.

The current repository has strong portable-object and provider boundaries, but no
deployed public peer network. The existing main worktree also contains extensive
uncommitted work and cannot safely serve as a release source.

## Decision

Ship an isolated, static wallet-entry protocol demonstrator.

WetDrool remains the product. DroolNet remains its portable Solana application
protocol. WOKE.NET names the future transport, sync, and independent-availability
research layer. Existing serialized namespaces are unchanged.

The alpha:

1. Detects an injected Solana wallet.
2. Requests a readable message signature only.
3. Verifies the Ed25519 signature locally without RPC.
4. Derives a non-extractable local AES-256-GCM key.
5. Encrypts private note and profile objects before IndexedDB storage.
6. Computes CIDv1 raw SHA-256 identifiers over encrypted object bytes.
7. Requests wallet signatures over local manifests.
8. Verifies every imported CID and signature before local commit.
9. Loads no third-party script, image, analytics, adult feed, or media API.
10. Exposes machine-readable status at /.well-known/wokenet-alpha.json.

## Explicit non-goals

- No public peer network, onion routing, anonymity, or decentralized-availability claim.
- No server authentication or production SIWS session.
- No onchain writes, payments, token gate, or active $WET mint.
- No adult media, public uploads, DMs, live streams, creator settlement, or external feeds.
- No claim that a wallet proves age, identity, personhood, gender, or consent.
- No AI-only moderation claim.

## Identity and inclusion

Chosen display name, pronouns, and discovery mode are optional and local. The client
does not infer identity from wallet activity. All, Straight, and Pride modes are
explicit user choices. Pride fixtures emphasize trans, femboy, and queer creators
without exposing the preference to a remote service.

## Consequences

The web host remains a centralized bootstrap and signed-app publisher remains a
future trust root. Local encryption cannot defend against a compromised device or
malicious application update. Traffic privacy, independent availability, recipient
key distribution, multi-device recovery, revocation, relay discovery, and provider
audits remain separate milestones.

This boundary can advance only when verified evidence exists. Marketing copy must
not collapse local cryptographic proofs into claims about a deployed network.
