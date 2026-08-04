---
tags: [wetdrool, safety, age, legal]
updated: 2026-08-04
---

# Safety — age access and hard bans

**Code:** `apps/web/lib/age-access-policy.ts`, `nsfw-mode.ts`  
**UI:** NSFW 18+ toggle in header

## Default product stance

| Rule | Value |
| ---- | ----- |
| Minimum age for NSFW | **18** |
| Default proof | **Self-attest** in browser |
| Government ID upload to WetDrool | **Off by default** (`collectGovernmentId: false`) |
| Wallet as age proof | **Never** |
| Operator vehicle | Swiss foundation **planned** |

## Hard bans (global)

- CSAM / child sexual exploitation material  
- Non-consensual intimate imagery  
- Trafficking facilitation  
- Real-world crime instruction for harm  
- Hate / targeted harassment / doxxing (policy enforcement layers)  

AI is **assistive**, not sole authority for CSAM/consent disputes — human escalation required.

## “Rebellious privacy” vs lawlessness

Privacy-preserving self-attest + E2EE is a product choice.  
**Incorporation in Switzerland does not erase criminal law** or platform duties where you operate.

## Related

- `docs/MODERATION.md`, `docs/PRIVACY.md`, `docs/LEGAL_REVIEW.md`
- [[Surface — Shorts RedGIFs]]
