# Agents Dashboard

A TUI/CLI tool for monitoring AI coding agents (Claude, Codex, OpenCode) running across tmux sessions.

## Installation

```bash
bun install
```

## Usage

```bash
# CLI mode - single snapshot
bun run cli

# CLI mode - continuous monitoring
bun run cli:watch

# TUI mode - interactive interface
bun run start
```

## How It Works

The tool detects agents by inspecting the process tree of each tmux pane. When an agent binary (`claude`, `codex`, `opencode`) is found as a child process, the pane is identified as running that agent.

Status is determined by analyzing pane content for agent-specific patterns (spinners, prompts, keywords).

## TUI Keybindings

- `j/k` - Navigate between agents
- `Enter` - Focus the selected pane
- `q` - Quit

## License

MIT
