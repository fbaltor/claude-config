#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')

COST_FMT=$(printf '$%.2f' "$COST")

# Color context % based on usage
if [ "$PCT" -ge 80 ]; then
  PCT_COLOR="\033[31m"  # red
elif [ "$PCT" -ge 50 ]; then
  PCT_COLOR="\033[33m"  # yellow
else
  PCT_COLOR="\033[32m"  # green
fi
RESET="\033[0m"

CAVE_PART=""
caveman_flag="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active"
if [ -f "$caveman_flag" ]; then
  cave_mode=$(cat "$caveman_flag" 2>/dev/null)
  if [ -n "$cave_mode" ]; then
    CAVE_PART=" | caveman:${cave_mode}"
  fi
fi

echo -e "${PCT_COLOR}${PCT}%${RESET} context | ${COST_FMT} | ${MODEL}${CAVE_PART}"
