#!/bin/bash
# Hoot 🦉 Weekly Grid Medic — Skill Health Audit
# Triggers Hoot to run a health check on all installed skills
# Results delivered via Telegram

BOT_TOKEN="8794621367:AAHDU4SlkpvC1HKfOgx-Hvyd1rFE7IxiuCQ"
CHAT_ID="8658497464"
LOG="$HOME/.max/grid-medic.log"

echo "[$(date)] Grid Medic starting..." >> "$LOG"

TOTAL=$(ls ~/.max/skills/ 2>/dev/null | wc -l | tr -d ' ')
HEALTHY=0
WARNINGS=""
WARN_COUNT=0
BROKEN=""
BROKEN_COUNT=0

for skill_dir in ~/.max/skills/*/; do
  skill=$(basename "$skill_dir")
  SKILL_FILE="$skill_dir/SKILL.md"

  # Check SKILL.md exists and non-empty
  if [ ! -f "$SKILL_FILE" ]; then
    BROKEN="${BROKEN}• ${skill} — missing SKILL.md\n"
    BROKEN_COUNT=$((BROKEN_COUNT + 1))
    continue
  fi

  SIZE=$(wc -c < "$SKILL_FILE" | tr -d ' ')

  if [ "$SIZE" -lt 10 ]; then
    BROKEN="${BROKEN}• ${skill} — SKILL.md is empty\n"
    BROKEN_COUNT=$((BROKEN_COUNT + 1))
    continue
  fi

  # Check frontmatter
  if ! head -5 "$SKILL_FILE" | grep -q "^---"; then
    WARNINGS="${WARNINGS}• ${skill} — missing frontmatter\n"
    WARN_COUNT=$((WARN_COUNT + 1))
    HEALTHY=$((HEALTHY + 1))
    continue
  fi

  # Size warning
  if [ "$SIZE" -gt 51200 ]; then
    SIZE_KB=$((SIZE / 1024))
    WARNINGS="${WARNINGS}• ${skill} — ${SIZE_KB}KB (large)\n"
    WARN_COUNT=$((WARN_COUNT + 1))
  fi

  HEALTHY=$((HEALTHY + 1))
done

# Build report
if [ "$WARN_COUNT" -eq 0 ] && [ "$BROKEN_COUNT" -eq 0 ]; then
  MSG="🚑 All ${TOTAL} superpowers healthy. No issues found. 🦉"
else
  MSG="🚑 Grid Medic — Skill Health Report\n\nTotal superpowers: ${TOTAL}\n✅ Healthy: ${HEALTHY}"
  if [ "$WARN_COUNT" -gt 0 ]; then
    MSG="${MSG}\n⚠️ Warnings: ${WARN_COUNT}\n${WARNINGS}"
  fi
  if [ "$BROKEN_COUNT" -gt 0 ]; then
    MSG="${MSG}\n❌ Broken: ${BROKEN_COUNT}\n${BROKEN}"
  fi
fi

echo "[$(date)] $MSG" >> "$LOG"

# Send to Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"$(echo -e "$MSG")\"}" > /dev/null

echo "[$(date)] Grid Medic complete." >> "$LOG"
