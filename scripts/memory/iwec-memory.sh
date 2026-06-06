#!/usr/bin/env bash
# iwec-memory.sh — launch the IWE MCP server (iwec) rooted at the memory
# library. iwec resolves its knowledge graph from the current working directory
# (see crates/iwec/src/main.rs: env::current_dir()), so cd in before exec.
#
# Loaded by the default `claude` session via ~/.claude/scripts/memory/iwe-mcp.json
# (--mcp-config in the bashrc wrapper); `claude --native` does not load it. See
# pkm/iwe-as-cc-memory in the library for the whole system.
set -euo pipefail
cd "$HOME/memory" || exit 1
exec iwec
