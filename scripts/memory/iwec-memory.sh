#!/usr/bin/env bash
# iwec-memory.sh — launch the IWE MCP server (iwec) rooted at the memory
# library. iwec resolves its knowledge graph from the current working directory
# (see crates/iwec/src/main.rs: env::current_dir()), so cd in before exec.
#
# Wired into `claude --iwe` via ~/.claude/iwe-mcp.json (opt-in). Plain `claude`
# never loads it. See pkm/iwe-as-cc-memory in the library for the whole system.
set -euo pipefail
cd "$HOME/memory" || exit 1
exec iwec
