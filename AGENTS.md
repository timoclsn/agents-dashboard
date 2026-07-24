# Agents Dashboard

A TUI/CLI tool for monitoring AI coding agents running across tmux sessions.

## Quick Start

```bash
bun run cli        # CLI mode - single poll, print, exit
bun run cli:watch  # CLI mode - continuous polling
bun run cli:debug  # CLI mode - show all panes with detection info
bun run start      # TUI mode
bun run dev        # TUI mode with hot reload
bun test           # Run tests
```

## Architecture

```
src/
├── index.tsx              # Entry point, CLI flag parsing
├── tui/
│   └── app.tsx            # TUI components (OpenTUI React)
├── cli/
│   └── output.ts          # CLI output formatting
├── tmux/
│   ├── client.ts          # Tmux commands (list-panes, capture, focus, open-worktree)
│   └── process.ts         # Process cache for child detection
├── agents/
│   ├── detect.ts          # Types + main detection + polling logic
│   ├── claude.ts          # Claude-specific patterns
│   ├── codex.ts           # Codex-specific patterns
│   └── opencode.ts        # OpenCode-specific patterns
└── worktrees/
    └── scan.ts            # Scan ~/Developer for -w- worktrees not open in tmux
```

`pollDashboard()` in `detect.ts` is the single poll used by both TUI and CLI: it
lists panes once, then builds agents and scans worktrees from the same pane data.

### Key Dependencies

- **@opentui/react** - TUI framework with React bindings
- **Bun** - Runtime, uses `$` shell template for tmux commands

## Agent Detection (`src/agents/`)

### How Agents Are Found

1. Run `ps -A -o pid=,ppid=,command=` to build process tree cache (cached 500ms)
2. Run `tmux list-panes -a` to get all panes with their PIDs
3. For each pane, walk child process tree and check for agent binaries:

| Agent        | Detection                    |
| ------------ | ---------------------------- |
| **Claude**   | `claude` in child commands   |
| **Codex**    | `codex` in child commands    |
| **OpenCode** | `opencode` in child commands |

Child process detection is reliable even when pane content scrolls - the process tree always shows the running binary.

### Status Detection

Status is `idle | working | blocked`. **Blocked** means the agent is waiting on
the user (permission/confirmation prompt) — the signal a monitoring dashboard
most needs to surface.

**Prefer the terminal title over pane content.** Agents set their terminal
title via OSC escape sequences, which tmux exposes as `#{pane_title}` (already
captured into `PaneInfo.title`). The title encodes both state and task, is
robust to scrollback, and needs no `capture-pane`. This mirrors how
[herdr](https://github.com/badlogic/herdr) detects state via an `osc_title`
region. Content scanning remains a fallback.

**Claude** (`#{pane_title}` = `<glyph> <task>`, e.g. `⠋ Refactor auth`):

- **Working**: leading braille spinner glyph (U+2800–U+28FF) in title
- **Blocked**: permission prompt (`Do you want to…` + `Yes`/`❯`) in bottom lines
- **Idle**: leading `✳` (U+2733) glyph in title
- Fallback: content spinner (`· Scampering…`, `Running…`) → working, else idle
- **Title**: strip the leading glyph from `#{pane_title}`; `✳ Claude Code`
  (the default, no task) → `null`

**Codex:**

- **Blocked**: `Action Required` in title, or approval prompt in content
- **Working**: braille spinner in title, or `esc to interrupt` in content
- **Idle**: everything else

**OpenCode** (no OSC title state — content only):

- **Blocked**: `Permission required` in content
- **Working**: `esc interrupt` in content
- **Idle**: everything else

**Detection Philosophy**: Check for definitive `working`/`blocked` indicators;
default to `idle`. Simpler and more reliable than enumerating all idle states.

### Tmux Data Format

Uses `|||` as separator (not `\t`) because Bun's shell escapes tabs:

```typescript
const format = `#{session_attached}|||#{session_name}|||...`;
const result = await $`tmux list-panes -a -F ${format}`.text();
```

## Worktree Detection (`src/worktrees/`)

Lists git worktrees on disk that aren't open in tmux, so they can be opened
quickly from the dashboard via the user's `tmux-sessionizer` script.

- **Which dirs**: scans `~/Developer/*/` for child dirs whose name contains the
  `-w-` infix (the `/worktree` skill's naming convention) where `.git` is a
  **file** (a linked worktree points at its gitdir; a normal repo's `.git` is a directory).
- **"Not open"**: a worktree is excluded if any tmux pane's `pane_current_path`
  equals it or sits under it. The pane list from `pollDashboard()` supplies these paths.
- **Caching**: the disk scan + git-branch lookups are cached 5s; the open-filter
  is applied live each poll against current pane paths.
- **Opening**: `Enter` (or click) runs `openWorktree(path)` in `client.ts`, which
  closes any popup then runs `tmux-sessionizer <path>` (must be on `PATH`).

## TUI Notes (`src/tui/app.tsx`)

- **Do NOT nest `<text>` inside `<text>`** - OpenTUI throws "TextNodeRenderable only accepts strings"
- Use `<box style={{ flexDirection: "row" }}>` for horizontal layouts with multiple text elements
- Keybindings: `j/k` navigate, `Enter` focus pane / open worktree, `q` quit
- Selection spans a unified `items` list (agents first, then worktrees); `Enter`
  focuses agent panes and opens worktree sessions, `^x` (kill) applies to agents only.

## CLI Flags

```
--cli, -c     Run in CLI mode (no TUI)
--watch, -w   Continuous polling (CLI mode only)
--debug, -d   Show all panes with detection info (CLI mode only)
```

## Output Legend

```
▸ ▶ ◆ claude   dotfiles:3.1   dotfiles
│ │ │ │        │              └── Project name (from path)
│ │ │ │        └── Tmux target (session:window.pane)
│ │ │ └── Agent type
│ │ └── Type icon (◆=claude, ◇=codex, ○=opencode)
│ └── Status (▶=working, ⏸=idle, ◼=blocked/waiting on user)
└── Attached session marker
```

## Adding a New Agent

1. Create `src/agents/newagent.ts`:

```typescript
import type { PaneInfo } from "../tmux/client";

const PROCESSING = /pattern|for|working/i;
const IDLE = /pattern|for|idle/i;

export const detectNewAgent = (pane: PaneInfo): boolean => {
  const cmds = pane.childCommands.map((c) => c.toLowerCase()).join(" ");
  return cmds.includes("newagent");
};

export const detectNewAgentStatus = (content: string): "idle" | "working" => {
  const last = content.slice(-500);
  if (PROCESSING.test(last)) return "working";
  if (IDLE.test(last)) return "idle";
  return "working";
};
```

2. Update `src/agents/detect.ts`:

```typescript
import { detectNewAgent, detectNewAgentStatus } from "./newagent";

// In detectAgentType():
if (detectNewAgent(pane)) return "newagent";

// In detectStatus():
if (agentType === "newagent") return detectNewAgentStatus(content);
```

3. Add type to `AgentType` and colors/icons to TUI/CLI.

## Future Improvements

- [x] Better idle detection (check for approval prompts)
- [ ] Context remaining percentage
- [ ] Subagent tracking
- [ ] Approve/reject from dashboard (send keys)
