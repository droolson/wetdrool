# Droolhouse — Paperclip company pack

Importable org for [Paperclip](https://paperclip.ing) +
[hermes-paperclip-adapter](https://github.com/NousResearch/hermes-paperclip-adapter)
on **Mythic Agent** / Hermes.

## Product map (mandatory)

| Product | Rating | URL |
|---------|--------|-----|
| **$DDD Games** | **SFW** | https://drooly.ai/games/ddd |
| **WetDrool** | **18+** | https://drooly.ai/games/wetdrool |
| **wetdrool.com** | 18+ | Redirects → games/wetdrool |

WetDrool is the **adult twin** of the $DDD skill arena. Economy: **$DDD** (pre-mint until official CA). **$DROOL does not exist.**

## Owner vs CEO

| Role | Actor | Runtime |
| ---- | ----- | ------- |
| **Owner** | Human (`kingofqueens6ix`) | No agent loop — dashboard only |
| **CEO** | Paperclip employee `ceo` | Hermes + **Grok 4.5 / xAI OAuth** |

## Inference (mandatory)

- **Use:** `xai-oauth` · `grok-4.5` (fallback `grok-4.3`)  
- **Do not use:** OpenAI OAuth, `openai-codex`, OpenAI API for company agents  

## Effort focus

**Build · market · distribute** WetDrool 18+ and keep SFW $DDD separate.

| ID | Scope |
| -- | ----- |
| `code-web` | games/wetdrool + wetdrool.com |
| `code-game` | arena engine / boards |
| `code-economy` | $DDD honesty |
| `code-edge` | Vercel / DNS / smoke |
| `growth` | 18+ distribution, clear SFW path |

## Import

```bash
npx paperclipai company import --from ./paperclip/droolhouse
```

## Workspaces

- `drooly-inc/repos/drooly-web` — game surfaces  
- `drooly-inc/repos/wetdrool-web` — domain redirect + this pack  

See `docs/ops/GAME_WETDROOL.md` in wetdrool-web.
