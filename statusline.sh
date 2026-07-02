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

# tokens currently in the context window (input incl. cache + output); null before first message
TOKENS=$(echo "$input" | jq -r '(.context_window.total_input_tokens // 0) + (.context_window.total_output_tokens // 0)')
TOK_PART=""
if [ "$TOKENS" -gt 0 ] 2>/dev/null; then
  if [ "$TOKENS" -ge 1000 ]; then
    TOK_PART=" $(awk "BEGIN { printf \"%.1fk\", $TOKENS / 1000 }")"
  else
    TOK_PART=" ${TOKENS}"
  fi
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

# --- Session usage: spend (cost.total_cost_usd) + plan limits (rate_limits, same data as /usage) ---
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
FIVEH=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# Fresh session: stdin has no rate_limits until the first API response lands.
# Fill the gap by fetching the OAuth usage endpoint (same data as /usage) in a
# detached background job — the hot path never blocks on the network. The cache
# file is only a render-to-render handoff (60s debounce), not a persistence
# layer: stdin wins as soon as it carries rate_limits.
if [ -z "$FIVEH" ]; then
  USAGE_CACHE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.usage-limits"
  USAGE_TTL=60
  umtime=$(stat -c %Y "$USAGE_CACHE" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - umtime )) -gt "$USAGE_TTL" ]; then
    touch "$USAGE_CACHE" 2>/dev/null   # debounce before launching the fetch
    (
      tok=$(jq -r '.claudeAiOauth.accessToken // empty' \
            "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" 2>/dev/null)
      [ -n "$tok" ] || exit 0
      u=$(curl -fsS --max-time 4 \
            -H "Authorization: Bearer $tok" \
            -H "anthropic-beta: oauth-2025-04-20" \
            https://api.anthropic.com/api/oauth/usage 2>/dev/null \
          | jq -c '{five_hour: .five_hour.utilization, seven_day: .seven_day.utilization}' 2>/dev/null)
      [ -n "$u" ] && printf '%s' "$u" > "$USAGE_CACHE"
    ) </dev/null >/dev/null 2>&1 &
  fi
  if [ -s "$USAGE_CACHE" ]; then
    FIVEH=$(jq -r '.five_hour // empty' "$USAGE_CACHE" 2>/dev/null)
    WEEK=$(jq -r '.seven_day // empty' "$USAGE_CACHE" 2>/dev/null)
  fi
fi

USAGE_PART=$(printf ' | $%.2f' "$COST")
if [ -n "$FIVEH" ]; then
  FIVEH=$(printf '%.0f' "$FIVEH")
  if [ "$FIVEH" -ge 80 ]; then
    LIM_COLOR="\033[31m"  # red
  elif [ "$FIVEH" -ge 50 ]; then
    LIM_COLOR="\033[33m"  # yellow
  else
    LIM_COLOR="\033[32m"  # green
  fi
  USAGE_PART="${USAGE_PART} ${LIM_COLOR}5h:${FIVEH}%%${RESET}"
  if [ -n "$WEEK" ]; then
    WEEK=$(printf '%.0f' "$WEEK")
    USAGE_PART="${USAGE_PART} wk:${WEEK}%%"
  fi
fi

# --- Claude Code version: current (from stdin) + latest (cached, bg-refreshed) ---
# The hot path must never block on the network. We read a cached "latest" and,
# only if the cache is older than TTL, kick a detached refresh and use whatever
# is cached this render. mtime is bumped up-front to debounce concurrent renders.
CUR=$(echo "$input" | jq -r '.version // empty')

VER_CACHE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.cc-latest-version"
VER_TTL=21600  # 6h
now=$(date +%s)
if [ -f "$VER_CACHE" ]; then
  LATEST=$(cat "$VER_CACHE" 2>/dev/null)
  vmtime=$(stat -c %Y "$VER_CACHE" 2>/dev/null || echo 0)
else
  LATEST=""; vmtime=0
fi
if [ $((now - vmtime)) -gt "$VER_TTL" ]; then
  touch "$VER_CACHE" 2>/dev/null   # debounce before launching the refresh
  (
    v=$(curl -fsS --max-time 4 \
          https://registry.npmjs.org/@anthropic-ai/claude-code/latest 2>/dev/null \
        | jq -r '.version // empty' 2>/dev/null)
    [ -n "$v" ] && printf '%s' "$v" > "$VER_CACHE"
  ) </dev/null >/dev/null 2>&1 &
fi

CC_PART=""
if [ -n "$CUR" ]; then
  if [ -z "$LATEST" ]; then
    CC_PART=" | cc ${CUR}"                            # latest unknown (cache empty/cold)
  elif [ "$LATEST" != "$CUR" ] \
     && [ "$(printf '%s\n%s\n' "$CUR" "$LATEST" | sort -V | tail -n1)" = "$LATEST" ]; then
    CC_PART=" | ${GOLD}cc ${CUR}→${LATEST}${RESET}"   # update available
  else
    CC_PART=" | cc ${CUR} ${GREEN}✓${RESET}"          # confirmed on latest
  fi
fi

# Format: user:cwd (branch) | context% | $cost 5h% wk% | model [effort] [caveman] [cc-version]
printf "${GREEN}$(whoami)${RESET}:${BLUE}${CWD}${GOLD}${GIT_BRANCH}${RESET} | ${PCT_COLOR}${PCT}%%${TOK_PART}${RESET} ctx${USAGE_PART} | ${MODEL}${EFFORT_PART}${CAVE_PART}${CC_PART}"
