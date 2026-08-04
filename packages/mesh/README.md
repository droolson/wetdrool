# `@wetdrool/mesh`

Anytype / **any-sync** inspired mesh foundation for WetDrool.

## Upstream (research + future binding)

| Repo | Role |
| ---- | ---- |
| [anyproto/any-sync](https://github.com/anyproto/any-sync) | P2P local-first E2EE space protocol |
| [anyproto/anytype-heart](https://github.com/anyproto/anytype-heart) | Client middleware / heart library |
| [anyproto/anytype-ts](https://github.com/anyproto/anytype-ts) | Desktop client (UI patterns) |

This package **does not vendor** those trees. It exports WetDrool contracts and a
fail-closed local store so the web app and docs can wire honestly.

## Planes

| Plane | Authority |
| ----- | --------- |
| DroolNet / Solana | Identity, handles, public anchors |
| Mesh (this package) | Local-first encrypted object sync |
| Vercel + CF Worker | Bootstrap HTTP only |

## Status

`getMeshCapabilityReport().productionMeshDeployed === false` until a reviewed
any-sync node binding and multi-peer drill exist.
