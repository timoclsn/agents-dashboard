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
│   ├── group.ts           # View-model: group agents+worktrees into repo→checkout→agent tree
│   ├── claude.ts          # Claude-specific patterns
│   ├── codex.ts           # Codex-specific patterns
│   └── opencode.ts        # OpenCode-specific patterns
├── github/
│   └── pr.ts              # Cached `gh pr list` lookup per checkout branch
└── worktrees/
    └── scan.ts            # Scan ~/Developer for -w- worktrees not open in tmux
```

`pollDashboard()` in `detect.ts` is the single poll used by both TUI and CLI: it
lists panes once, then builds agents and scans worktrees from the same pane data.
The TUI then runs the flat `{agents, worktrees}` through `groupByRepo()`
(`group.ts`) to build the repo → checkout → agent tree it renders; the CLI still
prints the flat list.

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
  (the default, no task) → `null`. When null, fall back to the session name Claude
  prints as the statusline's trailing ` | <session>` field
  (`parseClaudeStatuslineTitle`), so untitled sessions still show something.

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

## Grouping (`src/agents/group.ts`)

`groupByRepo({ agents, worktrees })` turns the flat poll result into the tree the
TUI renders: **repo → checkout → agent**.

- **Checkout** = one git checkout on disk: either the base repo clone or a linked
  `-w-` worktree. Open checkouts come from live agent panes; closed ones from the
  worktree scan (`isOpen: false`, no agents). A pane cd'd into a subdir resolves to
  its checkout root via the `~/Developer/<org>/<checkout>` convention.
- **Repo** groups a base + its worktrees under `<org>/<repo>` (the `-w-` suffix is
  stripped to find the base name), so e.g. all `ei-mono*` checkouts sit together.
- **Sort** is stable and predictable, so tiles never jump around: repos alphabetical
  by `org/repo`; checkouts alphabetical with the base (`main`) first and not-open
  worktrees trailing; agents in `window`/`pane` order. Agent state is shown by
  colour (tile border + glyph + header count badges), never by position.

## GitHub PRs (`src/github/pr.ts`)

Each tile shows a GitHub badge (` #<number>`) in its top-right when the checkout's
branch has a PR, coloured by state: **draft** (grey), **open / ready** (green),
**merged** (purple), **closed** (red). The badge replaces the branch text. After it
come a **CI glyph** (`✓` passing / `✗` failing / `•` pending, from `statusCheckRollup`)
and a **review glyph** when action is needed (`!` changes requested, `?` review
required, from `reviewDecision`).

- `gh pr list --head <branch> --state all --json …,reviewDecision,statusCheckRollup`
  runs with `cwd` = the checkout path, so `gh` resolves the right repo/host (works in
  linked worktrees too). Missing `gh`, no auth, or no PR all resolve to "no badge".
- gh hits the network, so results are cached 60s keyed by `path + branch` and
  refreshed in the background — decoupled from the 500ms poll. The TUI calls
  `refreshPrs()` on an interval and bumps a tick to re-render; tiles read the cache
  synchronously via `getCachedPr()`.
- The icon is a Nerd Font glyph (`U+F09B`); it needs a patched font to render.

## TUI Notes (`src/tui/app.tsx`)

Design: a **fixed 2-D grid** (not responsive). Rows = repos stacked vertically;
columns = a repo's checkouts (`main` + worktrees) laid out horizontally in a
**non-wrapping** row. Each row is windowed to the terminal width and scrolls
horizontally on its own; a full-height bordered arrow tile (`‹` / `›`) sits where
the hidden tile would be, showing there's more that way. A repo's own not-open
worktrees trail its row as ghost `⏎ open`
tiles; worktrees whose repo has no live session collect in a final `not open` row.

- **Do NOT nest `<text>` inside `<text>`** - OpenTUI throws "TextNodeRenderable only accepts strings"
- Use `<box style={{ flexDirection: "row" }}>` for horizontal layouts with multiple text elements
- Tiles are `<box>` with `border: true, borderStyle: "rounded", borderColor` in `style`
  (border props are valid `BoxOptions`; only `title` must be a top-level prop) and
  `flexShrink: 0` so they keep `TILE_WIDTH`.
- **Selection is the checkout (tile), not the agent** — agents are display-only. A
  tile shows its state via border colour; the selected tile's border is `COLORS.sel`.
- **Repo header badges count sessions (open checkouts) by status**, not agents, so
  the number matches the tiles on the row (e.g. `•3` = three idle checkouts). The
  top header still totals agents across the fleet.
- **Horizontal scroll is windowing, not a scrollbox**: `buildRows()` + `RowView`
  render only `visibleCount = ⌊width / (TILE_WIDTH+gap)⌋` tiles, shifting the start
  so the selected column stays visible. `visibleCount` comes from
  `useTerminalDimensions()` so it recomputes on resize.
- **Vertical follow**: a ref on the selected row + `scrollRef.current.scrollBy()`
  (using `viewport.y/height` vs `row.y/height`) keeps the selected repo in view.
- **Keys arrive two ways**: arrows/`return`/`escape` as `key.name`; plain letters
  (`j k h l n q`) as `key.sequence` (guard `!ctrl && !meta`).
- **Context % used**: Claude rows show the context window used (matching Claude
  Code), parsed from the statusline usage (`<used>/<total> (n%)` → `n`) by
  `parseClaudeContext` in `claude.ts`. Coloured dim / amber / red as it fills up;
  hidden for non-Claude agents or when no statusline is on screen.
- **Needs-you band**: a pinned strip above the grid lists every blocked agent
  across all repos (so it stays visible when scrolled off). Clicking an entry jumps
  to its session; `n` cycles the selection through blocked checkouts.
- Keybindings: `j/k` (or ↑/↓) move between repo rows; `h/l` (or ←/→) move between
  checkouts in the current row; `n` cycles blocked checkouts; `Enter` switches to
  the checkout's session at window `3` (the agents window) or opens a not-open
  worktree; `q`/`Esc` quit.

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
