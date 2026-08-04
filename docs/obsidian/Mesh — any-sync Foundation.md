---
tags: [wetdrool, mesh, anytype, p2p]
updated: 2026-08-04
---

# Mesh — any-sync foundation

**ADR:** `docs/DECISIONS/0014-any-sync-p2p-mesh-foundation.md`  
**Package:** `packages/mesh` (`@wetdrool/mesh`)  
**UI:** `/mesh`

## Upstream research

- https://github.com/anyproto/any-sync  
- https://github.com/anyproto/anytype-heart  
- https://github.com/anyproto/anytype-ts  

## Decision

Adopt any-sync **concepts** (local-first E2EE spaces, optional self-hosted nodes) as WetDrool’s content/sync plane. Do **not** vendor heart wholesale until license + binary review.

## Planes

| Plane | Role |
| ----- | ---- |
| DroolNet / Solana | Identity, handles, public anchors |
| Mesh | Encrypted object sync |
| Vercel + CF Worker | Bootstrap HTTP only |

## Status

`productionMeshDeployed: false` — MemorySpaceStore + fail-closed UnconfiguredMeshTransport only.

## Related

- [[Architecture — Authority Planes]]
- [[Deploy — Vercel and Cloudflare]]
