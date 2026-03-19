---
description: Pull a Linear document into a local markdown file (one-way sync, Linear → git)
disable-model-invocation: true
---

## Pull result

!`npx tsx "$HOME/.claude/scripts/linear-doc-sync.ts" pull $ARGUMENTS`

## Instructions

Report the result of the pull operation. If a file was created or updated, mention that the user should review the changes and commit if satisfied.

For initial setup (no frontmatter yet), the user can provide the document ID:
  /linear-pull-doc <file_path> --id <linear_document_id>
