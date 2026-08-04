# WetDrool wallet alpha

This directory is a self-contained static protocol demonstrator for wetdrool.com.

It proves a deliberately narrow slice:

- local Solana wallet control through a readable message signature;
- local Ed25519 verification without an RPC;
- a wallet-derived, non-extractable AES-256-GCM key;
- encrypted IndexedDB objects;
- CIDv1 raw SHA-256 object identifiers;
- wallet-signed local manifests;
- verified JSON export and import;
- local chosen-name, pronoun, and discovery-mode preferences;
- offline application-shell caching.

It does not implement Sign In With Solana server sessions, a public peer network,
onchain writes, adult content, uploads, feeds from external providers, payments,
token gating, age assurance, anonymity, or production E2EE messaging.

WetDrool is the product. DroolNet remains the Solana application protocol in this
repository. WOKE.NET is the separate future carrier/sync research layer. This alpha
does not rename existing serialized namespaces.

Run:

    python3 -m http.server 8080 --directory apps/wallet-alpha

Then open http://127.0.0.1:8080. A real injected Solana wallet is required for the
cryptographic user flow. Unit and static verification:

    node --test apps/wallet-alpha/tests/*.test.mjs
    node apps/wallet-alpha/scripts/verify.mjs

The approved wordmark is assets/wetdrool-wordmark.png with SHA-256:

    189edfc19f0dc276dfff2a34d7da4597ee9f45c93144431dfb9fc8b74223fead

The $WET rail is intentionally mint-pending. Update config.js only after the owner
provides the exact Solana mint and a separate review verifies the trade URL and
status copy.
