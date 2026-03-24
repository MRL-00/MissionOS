#!/bin/bash
# Reads OpenClaw session files and pushes active session data to the office server.
# Runs as a lightweight systemd service or cron — no LLM API calls needed.

OFFICE_URL="${OFFICE_URL:-http://localhost:3001}"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
INTERVAL="${SYNC_INTERVAL:-10}"
WINDOW_SECONDS="${WINDOW_SECONDS:-300}"

echo "[session-sync] Pushing to $OFFICE_URL every ${INTERVAL}s (window: ${WINDOW_SECONDS}s)"

while true; do
  NOW_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")
  CUTOFF_MS=$((NOW_MS - WINDOW_SECONDS * 1000))

  # Read all agent session stores and find recently active sessions
  SESSIONS=$(python3 -c "
import json, glob, sys, os

cutoff = int(sys.argv[1])
sessions = []
agents_dir = sys.argv[2] + '/agents'

for store_path in glob.glob(agents_dir + '/*/sessions/sessions.json'):
    agent_id = store_path.split('/agents/')[1].split('/')[0]
    try:
        with open(store_path) as f:
            data = json.load(f)
    except:
        continue

    # The store is a dict of sessionKey -> metadata
    if isinstance(data, dict):
        for key, meta in data.items():
            if not isinstance(meta, dict):
                continue
            updated = meta.get('updatedAt', meta.get('lastActivityAt', 0))
            if isinstance(updated, str):
                try:
                    from datetime import datetime
                    updated = int(datetime.fromisoformat(updated.replace('Z','+00:00')).timestamp() * 1000)
                except:
                    updated = 0
            if updated > cutoff:
                sessions.append({
                    'key': key,
                    'displayName': meta.get('displayName', meta.get('label', key)),
                    'status': 'active',
                    'agentId': agent_id,
                })

print(json.dumps({'sessions': sessions}))
" "$CUTOFF_MS" "$OPENCLAW_DIR" 2>/dev/null)

  if [ -n "$SESSIONS" ] && [ "$SESSIONS" != '{"sessions": []}' ]; then
    curl -s -X POST "$OFFICE_URL/api/openclaw/sessions" \
      -H "Content-Type: application/json" \
      -d "$SESSIONS" > /dev/null 2>&1
  fi

  sleep "$INTERVAL"
done
