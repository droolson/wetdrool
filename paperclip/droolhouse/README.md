# Droolhouse — Paperclip company pack

Importable org for [Paperclip](https://paperclip.ing) +
[hermes-paperclip-adapter](https://github.com/NousResearch/hermes-paperclip-adapter)
on **Mythic Agent** / Hermes.

## Owner vs CEO

| Role | Actor | Runtime |
| ---- | ----- | ------- |
| **Owner** | Human (`kingofqueens6ix`) | No agent loop — dashboard only |
| **CEO** | Paperclip employee `ceo` | Hermes + **Grok 4.5 / xAI OAuth** |

## Inference (mandatory)

- **Use:** `xai-oauth` · `grok-4.5` (fallback `grok-4.3`)  
- **Do not use:** OpenAI OAuth, `openai-codex`, OpenAI API for company agents  

Configure Hermes:

```bash
hermes model   # provider xai-oauth, default grok-4.5
hermes fallback
# remove openai-codex if still listed
```

## Coding swarm (5 specialists)

| ID | Effort | Scope |
| -- | ------ | ----- |
| `code-web` | high | apps/web + API |
| `code-protocol` | high | protocol / program / sdk |
| `code-services` | high | backend services |
| `code-economy` | medium | points / fame / $DROOL |
| `code-edge` | low | CF / Vercel / HOF pushes |

## Import

```bash
# From wetdrool repo root
npx paperclipai company import --from ./paperclip/droolhouse
```

Adapter defaults are in `org-chart.json` → `adapterDefaults`.

## Workspace path

Point Paperclip at this monorepo checkout (example):

`/Users/raphaelcardona/drooly-inc/repos/wetdrool-web`

## Autonomy

- CEO heartbeat 30m; moderation 5m; support 3m  
- Hermes approvals: `smart`  
- Tirith + secret redaction on  
- Checkpoints on  

## Related products (powered together)

| Surface | Role |
| ------- | ---- |
| wetdrool.com | Flagship adult social web app |
| drooly.ai | Sibling AI product |
| icefam.fm | Music / culture rail |
| drooly-agent | Private Hermes profile distribution |
| Paperclip | Company orchestration |
