# Droolhouse — Paperclip company pack

Importable org for [Paperclip](https://paperclip.ing) using the
[hermes-paperclip-adapter](https://github.com/NousResearch/hermes-paperclip-adapter)
against **Mythic Agent** (`canadasfemboy/mythic-agent`).

## Prerequisites

1. Mythic Agent installed (`~/mythic-agent`, `hermes` on PATH with Infisical wrapper)
2. Paperclip running (`npx paperclipai onboard --yes` or local clone)
3. Adapter: `npm install hermes-paperclip-adapter` in the Paperclip server and register `hermes_local`

## Import (after you finish wiring Hermes + Paperclip)

```bash
# From wetdrool repo root
npx paperclipai company import --from ./paperclip/droolhouse
```

Or manually create agents from `org-chart.json` with adapter config:

```json
{
  "adapterType": "hermes_local",
  "adapterConfig": {
    "model": "grok-4.5",
    "provider": "auto",
    "maxIterations": 80,
    "timeoutSec": 600,
    "persistSession": true,
    "hermesCommand": "hermes",
    "enabledToolsets": ["terminal", "file", "web", "memory", "skills", "delegation"],
    "checkpoints": true
  }
}
```

## Agents

| ID | File |
|----|------|
| ceo | `agents/ceo.md` |
| moderation-lead | `agents/moderation-lead.md` |
| support-agent | `agents/support-agent.md` |
| companion-curator | `agents/companion-curator.md` |
| engineering | (use monorepo `AGENTS.md` + wetdrool workspace) |
| growth / economy / trust-legal | create from `org-chart.json` missions |

## Workspace path

Point Paperclip project workspace at:

`/Users/raphaelcardona/Pinkman, Inc./wetdrool`

so agents share product docs and code.

## Autonomy profile (aggressive but not reckless)

- Heartbeats: moderation 5m, support 3m, eng 30m, CEO 60m
- Approvals in Hermes: `smart` (not YOLO)
- Cron approvals: deny
- Tirith + secret redaction on
- Checkpoints on for rollback
