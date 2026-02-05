# claude-simple-memory

Simple session memory for Claude Code with TF-IDF relevance filtering.

## Features

- ✅ Automatic session context injection on startup
- ✅ TF-IDF relevance filtering (not just recent sessions)
- ✅ Cross-project memory search
- ✅ No background worker required
- ✅ Works without API key

## Installation

```
/plugins marketplace add kimnamwook1/claude-simple-memory
/plugins add kimnamwook1/claude-simple-memory
```

## Commands

- `/mem-search <keyword>` - Search saved sessions
- `/mem-timeline [count]` - Show recent sessions
- `/mem-show` - Show current buffer
- `/mem-stats` - Memory statistics

## How It Works

1. **SessionStart**: Loads relevant past sessions using TF-IDF
2. **PostToolUse**: Records Edit/Write/Bash/Task operations
3. **Stop**: Saves session summary to memory

## Data Location

`~/.claude-simple-memory/`
- `buffer.json` - Current session
- `memories/*.json` - Saved sessions

## License

MIT
