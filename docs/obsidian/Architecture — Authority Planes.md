---
tags: [wetdrool, architecture]
updated: 2026-08-04
---

# Architecture — authority planes

Canonical deep dive: `docs/ARCHITECTURE.md`.

## Four state classes (never conflate)

1. **Verifiable protocol state** — DroolNet program + finalized Solana history  
2. **Signed portable objects** — manifests, content hashes, Ed25519  
3. **Derived projections** — Postgres/Redis indexer (disposable)  
4. **Private/ephemeral** — E2EE envelopes, moderation evidence, rate limits  

## Product data flow (target)

```text
Client sign → CAS store → anchor reference → indexer verify → feed UI
Private: client encrypt → mesh/relay ciphertext only
```

## Web app role

`apps/web` is a **replaceable client**. It must show degraded states when indexer/RPC absent — never invent posts.

## Related

- [[Mesh — any-sync Foundation]]
- [[Surface — Private E2EE]]
- Protocol: `docs/PROTOCOL.md`
