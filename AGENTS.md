# Agents Dashboard

A TUI/CLI tool for monitoring AI coding agents running across tmux sessions.

## Quick Start

```bash
bun run cli        # CLI mode - single poll, print, exit
bun run cli:watch  # CLI mode - continuous polling
bun run cli:debug  # CLI mode - show all panes with detection info
bun run start      # TUI mode
bun run dev        # TUI mode with hot reload
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
│   ├── client.ts          # Tmux commands (list-panes, capture, focus)
│   └── process.ts         # Process cache for child detection
└── agents/
    ├── detect.ts          # Types + main detection + polling logic
    ├── claude.ts          # Claude-specific patterns
    ├── codex.ts           # Codex-specific patterns
    └── opencode.ts        # OpenCode-specific patterns
```

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

**Claude:**

- **Working**: Spinner character in pane title (`⠿⠇⠋⠙⠸⠴⠦⠧⠖⠏...`)
- **Idle**: Prompt `❯` in content

**Codex:**

- **Working**: Keywords `thinking`, `running`, `executing`, `generating`
- **Idle**: Keywords `context left`, `ready`, `waiting for` or prompt `›`

**OpenCode:**

- **Working**: Keywords `thinking`, `processing`, `generating`, `analyzing`, `working`
- **Idle**: Keywords `ready`, `waiting`, `idle`

**Fallback**: Prompt patterns (`❯`, `›`, `>`, `$`) at end of any line

### Tmux Data Format

Uses `|||` as separator (not `\t`) because Bun's shell escapes tabs:

```typescript
const format = `#{session_attached}|||#{session_name}|||...`;
const result = await $`tmux list-panes -a -F ${format}`.text();
```

## TUI Notes (`src/tui/app.tsx`)

- **Do NOT nest `<text>` inside `<text>`** - OpenTUI throws "TextNodeRenderable only accepts strings"
- Use `<box style={{ flexDirection: "row" }}>` for horizontal layouts with multiple text elements
- Keybindings: `j/k` navigate, `Enter` focus pane, `q` quit

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
│ └── Status (▶=working, ⏸=idle)
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

- [ ] Better idle detection (check for approval prompts)
- [ ] Context remaining percentage
- [ ] Subagent tracking
- [ ] Approve/reject from dashboard (send keys)
