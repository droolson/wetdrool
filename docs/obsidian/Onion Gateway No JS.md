---
tags: [wetdrool, onion, tor, security]
updated: 2026-08-04
---

# Onion gateway · no JavaScript

**App:** `apps/onion`  
**Local:** `http://127.0.0.1:3080`  
**Tor:** `apps/onion/torrc.example`

## Properties

| Property | Value |
| -------- | ----- |
| JavaScript | **None** (`script-src 'none'`) |
| Trackers / CDNs | **None** |
| Rooms | Passphrase-sealed AES-256-GCM |
| Media | img / GIF / video via form upload |
| Clearnet product | https://wetdrool.com (JS app) |

## Crypto honesty

JS-free HTML **cannot** do client-only E2EE. Server decrypts **only while rendering** a response; passphrase is not stored. Classic client E2EE: `/rooms/*` on clearnet.

## Deploy

1. Vercel project root = `apps/onion`
2. Tor HiddenServicePort 80 → local proxy or self-hosted Node
3. Link `.onion` from wetdrool.com when hostname exists

## Related

- [[E2EE Rooms Middle-Out Edge]]
- [[Safety — Age Access and Hard Bans]]
