#!/bin/bash
# Hoot 🦉 Daily Skill Sync
# Syncs all skills from github/awesome-copilot into ~/.max/skills/
# Run via launchd daily or manually: bash ~/hoot/sync-awesome-skills.sh

BOT_TOKEN="8794621367:AAHDU4SlkpvC1HKfOgx-Hvyd1rFE7IxiuCQ"
CHAT_ID="8658497464"
LOG="$HOME/.max/skill-sync.log"

echo "[$(date)] Skill sync starting..." >> "$LOG"

# Check network
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 https://api.github.com 2>/dev/null)
if [ "$STATUS" = "000" ] || [ -z "$STATUS" ]; then
  echo "[$(date)] Network unreachable, skipping sync" >> "$LOG"
  exit 0
fi

# Fetch current skill list from awesome-copilot
gh api "repos/github/awesome-copilot/contents/skills" --paginate --jq '.[].name' > /tmp/awesome-skill-list.txt 2>/dev/null
TOTAL=$(wc -l < /tmp/awesome-skill-list.txt | tr -d ' ')

if [ "$TOTAL" -lt 1 ]; then
  echo "[$(date)] Could not fetch skill list, skipping" >> "$LOG"
  exit 0
fi

mkdir -p ~/.max/skills
NEW=0

while IFS= read -r skill; do
  [ -z "$skill" ] && continue
  [ -f "$HOME/.max/skills/$skill/SKILL.md" ] && continue

  mkdir -p "$HOME/.max/skills/$skill"
  CONTENT=$(curl -sL "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/${skill}/SKILL.md" 2>/dev/null)

  if [ -z "$CONTENT" ] || echo "$CONTENT" | head -1 | grep -q "404"; then
    rmdir "$HOME/.max/skills/$skill" 2>/dev/null
    continue
  fi

  echo "$CONTENT" > "$HOME/.max/skills/$skill/SKILL.md"
  printf '{"slug":"%s","version":"1.0.0","source":"github/awesome-copilot"}\n' "$skill" > "$HOME/.max/skills/$skill/_meta.json"
  NEW=$((NEW + 1))
done < /tmp/awesome-skill-list.txt

FINAL_COUNT=$(ls ~/.max/skills/ | wc -l)
echo "[$(date)] Sync complete. $NEW new skills. $FINAL_COUNT total." >> "$LOG"

# Notify only if new skills were added
if [ "$NEW" -gt 0 ]; then
  # Build detailed list of new items with type and link
  NEW_LIST=""
  while IFS= read -r skill; do
    [ -z "$skill" ] && continue
    SKILL_FILE="$HOME/.max/skills/$skill/SKILL.md"
    [ ! -f "$SKILL_FILE" ] && continue
    CREATED=$(stat -f "%m" "$SKILL_FILE" 2>/dev/null)
    NOW=$(date +%s)
    AGE=$(( NOW - CREATED ))
    if [ "$AGE" -lt 120 ]; then
      # Parse frontmatter for name and description
      SNAME=$(grep "^name:" "$SKILL_FILE" 2>/dev/null | head -1 | sed 's/^name: *//')
      [ -z "$SNAME" ] && SNAME="$skill"
      SDESC=$(grep "^description:" "$SKILL_FILE" 2>/dev/null | head -1 | sed 's/^description: *//' | cut -c1-80)

      # Determine type by checking content
      if grep -qi "tool\|mcp\|server\|endpoint" "$SKILL_FILE" 2>/dev/null; then
        TYPE="🔧 Tool"
      elif grep -qi "agent\|worker\|orchestrat" "$SKILL_FILE" 2>/dev/null; then
        TYPE="🤖 Agent"
      else
        TYPE="⚡ Skill"
      fi

      LINK="https://github.com/github/awesome-copilot/tree/main/skills/${skill}"
      NEW_LIST="${NEW_LIST}${TYPE}: ${SNAME}\n   ${SDESC}\n   ${LINK}\n\n"
    fi
  done < /tmp/awesome-skill-list.txt

  MSG="🦉 New superpowers from awesome-copilot just added to Hoot!\n\n${NEW_LIST}${NEW} new superpowers loaded. Total: ${FINAL_COUNT}. Ready on your next message!"
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"$(echo -e "$MSG")\", \"disable_web_page_preview\": true}" > /dev/null
fi
