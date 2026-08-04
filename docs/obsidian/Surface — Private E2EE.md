---
tags: [wetdrool, e2ee, messaging]
updated: 2026-08-04
---

# Surface — Private E2EE

**Route:** `/messages`  
**Code:** `lib/e2ee-status.ts`, `packages/messaging`

## Protocol

`wetdrool.com.messaging.pairwise.v1` — Matrix Rust crypto WASM adapter (ADR-0007).

## Honest capability report

- Pairwise: package exists, **web not fully wired**
- Group rooms: **disabled**
- Server-readable fallback: **false** by design
- Storage mode today: volatile memory / test

## Product rule

Never show a fake inbox. Prefer capability report + lock state until device store + key directory + relay are configured.

## Related

- [[Architecture — Authority Planes]]
- ADR `docs/DECISIONS/0007-messaging-cryptographic-engine.md`
