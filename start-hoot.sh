#!/bin/bash
# Wait for Copilot SDK to be reachable
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://api.github.com 2>/dev/null)
  if [ "$STATUS" != "000" ] && [ "$STATUS" != "" ]; then
    break
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done

# Clear stale session
sqlite3 ~/.hoot/hoot.db "DELETE FROM hoot_state WHERE key='orchestrator_session_id';" 2>/dev/null

# Start Hoot
cd ~/hoot && exec npx tsx src/daemon.ts
