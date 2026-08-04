---
tags: [wetdrool, e2ee, middle-out, cloudflare, vercel]
updated: 2026-08-04
---

# E2EE rooms · middle-out · Vercel + Cloudflare

## Quality model (WokeNet)

Middle-out is **not** a video pixel codec. High quality means:

- Image/GIF/video bytes **pass through** as codec output (no re-encode)
- Protocol/text envelopes use **CDC chunking + content IDs** (Layer 1)
- Lossless self-check before accept

Package: `@wetdrool/middle-out-lite` (portable subset of `wokenet/packages/middle-out`).

## Seal pipeline

```text
plaintext / media bytes
  → middle-out-lite frame
  → AES-256-GCM (room passphrase → PBKDF2 key)
  → POST ciphertext to host
```

Host never receives the passphrase.

## Hosts

| Layer | Path |
| ----- | ---- |
| **Vercel** UI | `https://wetdrool.com/rooms/:id` |
| **Vercel** API | `/api/v1/rooms/:id/messages` (in-memory alpha) |
| **Cloudflare Worker** | `workers/wetdrool-rooms` + KV (`ROOMS`) multi-edge |

## Related

- [[Surface — Private E2EE]]
- [[Mesh — any-sync Foundation]]
- [[Deploy — Vercel and Cloudflare]]
