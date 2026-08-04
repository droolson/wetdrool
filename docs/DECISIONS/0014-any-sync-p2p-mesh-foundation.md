# 0014 — Anytype / any-sync as P2P mesh foundation

## Status

Accepted (implementation: interfaces + local store only)

## Context

WetDrool needs a **local-first, E2EE, peer-sync** content plane for private and
adult creator data that is not owned by a single host. Anytype’s open stack
([any-sync](https://github.com/anyproto/any-sync),
[anytype-heart](https://github.com/anyproto/anytype-heart),
[anytype-ts](https://github.com/anyproto/anytype-ts)) is the chosen research
and future binding foundation.

Hosting remains **Vercel** (app) + **Cloudflare** (DNS/TLS/Worker edge). Edge
HTTP is **not** the mesh.

## Decision

1. Adopt any-sync concepts: encrypted spaces, local-first stores, optional
   self-hosted nodes, replaceable transports.
2. Land WetDrool contracts in `@wetdrool/mesh` before vendoring heart binaries.
3. Keep DroolNet/Solana as identity/settlement — never as private media store.
4. UI design may take Anytype cues (sidebar, object cards, dark canvas) without
   forking anytype-ts wholesale.
5. Safety: 18+ self-attest, no gov-ID by default, CSAM/illegal still banned;
   Swiss foundation is planned operator vehicle, not “no laws.”

## Consequences

- Production mesh claims stay false until multi-peer evidence exists.
- Cloudflare Worker only reverse-proxies to Vercel.
- Future work: license review, any-sync node adapter, browser WASM packaging,
  Seeker peer nodes.
