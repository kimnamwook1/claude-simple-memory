---
name: mem-search
description: Search saved sessions by keyword
argument-hint: <keyword>
allowed-tools:
  - Bash
---

# Memory Search Command

Search through saved session memories for relevant entries.

## Usage

The user provides a keyword to search for in their session history.

## Instructions

1. Take the search keyword from the user's command arguments
2. Run the search command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-commands.js" search <keyword>
```

3. Display the results to the user in markdown format
