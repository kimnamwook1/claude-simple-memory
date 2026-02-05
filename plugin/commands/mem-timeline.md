---
name: mem-timeline
description: Show recent session timeline
argument-hint: "[count]"
allowed-tools:
  - Bash
---

# Memory Timeline Command

Display a timeline of recent sessions.

## Usage

Optionally specify a count to limit results (default: 10).

## Instructions

1. Get optional count from arguments (default 10)
2. Run the timeline command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-commands.js" timeline [count]
```

3. Display the timeline to the user
