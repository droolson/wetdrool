---
tags: [wetdrool, ai]
updated: 2026-08-04
---

# AI — Drool (in-app) and DROOLY.AI

**Code:** `lib/grok-chat.ts`, `lib/drool-ai.ts`, `lib/drooly-bridge.ts`  
**UI:** Ask Drool dock, `/ai`

## Separation

| Surface | Origin | Adult context |
| ------- | ------ | ------------- |
| Drool dock / companions | wetdrool.com | Yes (NSFW-aware system prompt when opted in) |
| DROOLY.AI | drooly.ai | Separate product; no session sharing |

Never forward E2EE plaintext or age/consent records cross-origin.

## Runtime honesty

- Frontend dock works offline as local transcript + system notices  
- Live model replies need `WETDROOL_GROK_API_KEY` / server route  
- Self-hosted inference URL must be loopback HTTP or HTTPS credential-free  

## Related

- `docs/AI_PLATFORM.md`
- [[00 Home — WetDrool Knowledge Base]]
