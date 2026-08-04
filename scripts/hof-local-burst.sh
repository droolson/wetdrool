#!/usr/bin/env bash
# Local burst of hall-of-fame heartbeats (optional). Prefer GitHub Actions for 24/7.
# Usage: ./scripts/hof-local-burst.sh [count] [sleep_seconds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COUNT="${1:-12}"
SLEEP="${2:-30}"
BRANCH="hall-of-fame"

git fetch origin "$BRANCH" 2>/dev/null || true
if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH" || true
else
  git checkout -B "$BRANCH"
fi

mkdir -p ops/hall-of-fame
for i in $(seq 1 "$COUNT"); do
  TS_UTC=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "{\"ts\":\"${TS_UTC}\",\"run_id\":\"local-${i}\",\"event\":\"local-burst\",\"actor\":\"$(git config user.email 2>/dev/null || echo local)\"}" >> ops/hall-of-fame/ledger.ndjson
  TOTAL=$(wc -l < ops/hall-of-fame/ledger.ndjson | tr -d ' ')
  cat > ops/hall-of-fame/counter.json <<EOF
{
  "schema": "wetdrool.hall_of_fame.v1",
  "total_heartbeats": ${TOTAL},
  "last_heartbeat_utc": "${TS_UTC}",
  "branch": "hall-of-fame",
  "note": "Local burst script — prefer Actions for 24/7"
}
EOF
  git add ops/hall-of-fame
  git commit -m "chore(hof): local heartbeat ${TS_UTC} (#${TOTAL})" || true
  git push -u origin "$BRANCH" || git push origin "$BRANCH"
  echo "pushed ${i}/${COUNT} total_lines=${TOTAL}"
  if [ "$i" -lt "$COUNT" ]; then
    sleep "$SLEEP"
  fi
done
