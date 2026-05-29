#!/usr/bin/env bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
CWD=$(echo "$input" | jq -r '.cwd // empty')
[ -z "$CWD" ] && CWD=$(pwd)

# used_percentage is null before first message; fall back to 0
PCT_RAW=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -z "$PCT_RAW" ]; then
  PCT=0
else
  PCT=$(printf '%.0f' "$PCT_RAW")
fi

# effort level from the schema (present when model supports reasoning effort)
EFFORT=$(echo "$input" | jq -r '.effort.level // empty')

# PS1-style colors (matching ~/.bashrc)
GREEN="\033[01;32m"
BLUE="\033[01;34m"
GOLD="\033[33m"

# Color context % based on usage
if [ "$PCT" -ge 80 ]; then
  PCT_COLOR="\033[31m"  # red
elif [ "$PCT" -ge 50 ]; then
  PCT_COLOR="\033[33m"  # yellow
else
  PCT_COLOR="\033[32m"  # green
fi
RESET="\033[0m"

# Git branch (skip optional locks to avoid contention)
GIT_BRANCH=""
if git -C "$CWD" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$CWD" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null \
    || git -C "$CWD" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  [ -n "$branch" ] && GIT_BRANCH=" ($branch)"
fi

CAVE_PART=""
caveman_flag="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.caveman-active"
if [ -f "$caveman_flag" ]; then
  cave_mode=$(cat "$caveman_flag" 2>/dev/null)
  if [ -n "$cave_mode" ]; then
    CAVE_PART=" | caveman:${cave_mode}"
  fi
fi

EFFORT_PART=""
if [ -n "$EFFORT" ]; then
  EFFORT_PART=" | effort:${EFFORT}"
fi

# Format: user:cwd (branch) | context% | model [effort] [caveman]
printf "${GREEN}$(whoami)${RESET}:${BLUE}${CWD}${GOLD}${GIT_BRANCH}${RESET} | ${PCT_COLOR}${PCT}%%${RESET} ctx | ${MODEL}${EFFORT_PART}${CAVE_PART}"
