#!/bin/bash
# Install all skills from github/awesome-copilot into Hoot
BOT_TOKEN="${HOOT_TELEGRAM_TOKEN:?Error: HOOT_TELEGRAM_TOKEN not set}"
CHAT_ID="${HOOT_CHAT_ID:?Error: HOOT_CHAT_ID not set}"

echo "[awesome] Waiting for network..."
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://api.github.com 2>/dev/null)
  if [ "$STATUS" != "000" ] && [ "$STATUS" != "" ]; then
    echo "[awesome] Network is back! (HTTP $STATUS)"
    break
  fi
  echo "[awesome] Still waiting... $(date +%H:%M:%S)"
  sleep 30
done

echo "[awesome] Fetching skill list from github/awesome-copilot..."
gh api "repos/github/awesome-copilot/contents/skills" --paginate --jq '.[].name' > /tmp/awesome-skill-list.txt 2>/dev/null
TOTAL=$(wc -l < /tmp/awesome-skill-list.txt | tr -d ' ')
echo "[awesome] Found $TOTAL skills"

mkdir -p ~/.hoot/skills
SUCCESS=0

while IFS= read -r skill; do
  [ -z "$skill" ] && continue
  [ -f "$HOME/.hoot/skills/$skill/SKILL.md" ] && continue

  mkdir -p "$HOME/.hoot/skills/$skill"
  DL_URL="https://raw.githubusercontent.com/github/awesome-copilot/main/skills/${skill}/SKILL.md"
  CONTENT=$(curl -sL "$DL_URL" 2>/dev/null)

  if [ -z "$CONTENT" ] || echo "$CONTENT" | head -1 | grep -q "404"; then
    rmdir "$HOME/.hoot/skills/$skill" 2>/dev/null
    continue
  fi

  echo "$CONTENT" > "$HOME/.hoot/skills/$skill/SKILL.md"
  printf '{"slug":"%s","version":"1.0.0","source":"github/awesome-copilot"}\n' "$skill" > "$HOME/.hoot/skills/$skill/_meta.json"
  SUCCESS=$((SUCCESS + 1))

  if [ $((SUCCESS % 50)) -eq 0 ]; then
    echo "[awesome] ... installed $SUCCESS"
  fi
done < /tmp/awesome-skill-list.txt

FINAL_COUNT=$(ls ~/.hoot/skills/ | wc -l)
echo "[awesome] Done! $SUCCESS new skills installed. $FINAL_COUNT total."

# Restart Hoot
launchctl unload ~/Library/LaunchAgents/com.dubsopenhub.hoot.plist 2>/dev/null
sleep 3
sqlite3 ~/.hoot/hoot.db "DELETE FROM hoot_state WHERE key='orchestrator_session_id';" 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.dubsopenhub.hoot.plist 2>/dev/null
sleep 15

# Notify on Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"🦉 SUPERCHARGED! Installed $SUCCESS skills from awesome-copilot. Hoot now has $FINAL_COUNT total skills. Every superpower loaded. Try me!\"}" > /dev/null

echo "[awesome] Telegram notified. All done."
