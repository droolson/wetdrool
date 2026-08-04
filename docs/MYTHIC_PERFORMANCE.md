# Mythic Agent — Max Performance & Efficiency (Security-Aware)

**Install:** `~/mythic-agent` (private SoT: `canadasfemboy/mythic-agent`)  
**Config:** `~/.hermes/config.yaml`  
**Secrets:** Infisical via `~/.hermes/bin/with-infisical` → do not put API keys in git

Applied defaults already tuned for Droolhouse autonomy. Use this as the operator runbook.

---

## 1. Source of truth workflow

```bash
cd ~/mythic-agent
git remote -v
# origin   → canadasfemboy/mythic-agent (push here)
# upstream → NousResearch/hermes-agent (pull carefully)

git fetch upstream
git merge upstream/main   # review diffs; do not blind-auto
git push origin main
# if deps changed:
./setup-hermes.sh
```

Prefer this over unattended `hermes update` when you have private patches.

---

## 2. Model routing (throughput × quality)

| Workload | Recommended | Why |
|----------|-------------|-----|
| Companion RP / product chat | **Grok 4.5** | Immersion, long context feel |
| Org coding / monorepo | Codex / strong coding model | Tool reliability |
| Compression / classify | Fast cheap model | Token burn control |
| Fallback | xAI OAuth Grok | Resilience |

Set primary + fallback:

```bash
hermes model
hermes fallback
```

**Efficiency tip:** Keep `auxiliary.compression` on a cheap/fast model so long sessions do not re-spend premium tokens summarizing.

---

## 3. Context & compression (biggest $ lever)

Already set toward aggressive efficiency:

- `compression.threshold: 0.5` — compact earlier
- `target_ratio: 0.18` — smaller residual tail
- `proactive_prune_tokens: 12000` — strip huge tool dumps without an LLM call
- `prompt_caching.cache_ttl: 1h` — reuse stable system/skill prefixes

Raise threshold toward `0.65` only if you see over-summarization losing goals.

---

## 4. Parallelism

- `delegation.max_concurrent_children: 8`
- `max_spawn_depth: 2` (depth 3 multiplies cost/risk)
- `orchestrator_enabled: true`

For risky batch jobs, drop concurrency to 3–4 and enable worktrees:

```yaml
worktree: true
worktree_sync: true
```

---

## 5. Terminal backend

| Mode | When |
|------|------|
| **local** (default) | Max speed on your Mac for eng agents |
| **docker** | Untrusted code, dependency installs, web scrapes |
| **ssh / modal / daytona** | Burst capacity without cooking the laptop |

Security without nerfing local speed:

```yaml
terminal:
  backend: local
  timeout: 240
  persistent_shell: true
```

Switch individual profiles to docker when an agent handles untrusted PRs.

---

## 6. Security that is worth the cost

Keep these **on** (already):

- `security.tirith_enabled: true` + `tirith_fail_open: false`
- `redact_secrets: true`
- `allow_private_urls: false` (open only if agents must hit LAN Infisical/Paperclip — prefer explicit allowlists)
- `approvals.mode: smart` — **not** YOLO for org agents
- `approvals.cron_mode: deny` — cron cannot self-approve destructive work

Optional extra (only if you need it):

- Docker backend for untrusted tasks
- `skills.write_approval: true` / `memory.write_approval: true` for production-facing profiles

Do **not** “secure” by disabling tools the org needs (terminal, web, delegation) without a concrete threat — that nerfs autonomy for theater.

---

## 7. Paperclip + Hermes adapter

```bash
npm install hermes-paperclip-adapter
# register hermes_local in Paperclip server adapter registry
```

Adapter config for Droolhouse employees:

```json
{
  "model": "grok-4.5",
  "timeoutSec": 600,
  "persistSession": true,
  "checkpoints": true,
  "toolsets": "terminal,file,web,memory,skills,delegation,code_execution"
}
```

Heartbeats: moderation 5m, support 3m, eng 30m — short heartbeats for safety queues, longer for deep eng.

---

## 8. Observability & cost control

```bash
hermes insights --days 7
hermes sessions prune   # when history bloats
hermes doctor
```

Track: tokens/task, failed tool loops, checkpoint disk, gateway restarts.

Checkpoints: enabled with prune (`max_total_size_mb: 1536`, `retention_days: 21`).

---

## 9. Profiles (optional multi-agent isolation)

```bash
hermes profile create moderation
hermes profile create companions
hermes profile create eng
```

Separate SOUL.md / memories per surface so companion RP never bleeds into moderation policy work.

---

## 10. What not to do

- Don’t put xAI/OpenAI keys in the wetdrool git tree
- Don’t set `approvals.mode: off` on internet-facing gateway
- Don’t let points or companion free tiers mint unbounded compute
- Don’t claim `$DROOL` is live before mint + deployments.json
EOF