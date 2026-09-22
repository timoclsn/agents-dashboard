import { useState, useEffect, useRef, type Ref } from "react";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { pollDashboard, type Agent } from "../agents/detect";
import { groupByRepo, type Checkout } from "../agents/group";
import { focusPane, openWorktree } from "../tmux/client";
import {
  buildRows,
  clampSelection,
  lineWidthFor,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  tilesPerLine,
  TILE_GAP,
  TILE_WIDTH,
  type RenderRow,
  type Selection,
} from "./grid";
import {
  refreshPrs,
  getCachedPr,
  type PrState,
  type PrChecks,
} from "../github/pr";

const POLL_INTERVAL = 500;
const SPINNER_INTERVAL = 80;
const LOADER_INTERVAL = 120;
const MIN_LOADER_DURATION = 1000;

const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
const IDLE_ICON = "•";
const BLOCKED_ICON = "◼";

// The agents window in every session (tmux-sessionizer convention).
const AGENTS_WINDOW = 3;

const MAX_TASK = 25;
const MAX_NAME = 19;
const MAX_BRANCH = 10;

// Muted neon-on-near-black — sits alongside nvim / lazygit / tmux rather than shouting.
const COLORS = {
  text: "#d3dceb",
  dim: "#818da6",
  faint: "#515b73",
  work: "#57c7dd",
  blocked: "#e5638f",
  idle: "#6b7690",
  attached: "#9ccc5a",
  borderDim: "#2c3547",
  sel: "#e8eefc",
  prDraft: "#8b98a8",
  prOpen: "#57ab5a",
  prMerged: "#a684d6",
  prClosed: "#e0656f",
  prPending: "#d1b45a",
};

// Nerd Font GitHub glyph (fa-github).
const GITHUB_ICON = "";

const prColor = (state: PrState): string => {
  if (state === "draft") return COLORS.prDraft;
  if (state === "open") return COLORS.prOpen;
  if (state === "merged") return COLORS.prMerged;
  return COLORS.prClosed;
};

const checkGlyph = (checks: PrChecks): string =>
  checks === "passing" ? "✓" : checks === "failing" ? "✗" : "•";

const checkColor = (checks: PrChecks): string =>
  checks === "passing"
    ? COLORS.prOpen
    : checks === "failing"
      ? COLORS.prClosed
      : COLORS.prPending;

// Context window used: dim when healthy, amber as it fills, red when nearly full.
const contextColor = (percent: number): string =>
  percent >= 85 ? COLORS.blocked : percent >= 60 ? COLORS.prPending : COLORS.dim;

const TYPE_ICONS: Record<Agent["type"], string> = {
  claude: "◆",
  codex: "◇",
  opencode: "○",
  pi: "π",
  unknown: "?",
};

const statusColor = (status: Agent["status"]): string => {
  if (status === "blocked") return COLORS.blocked;
  if (status === "working") return COLORS.work;
  return COLORS.idle;
};

const truncate = (str: string, max: number): string =>
  str.length <= max ? str : str.slice(0, max - 1) + "…";

const useSpinner = (active: boolean) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(interval);
  }, [active]);

  return active ? SPINNER_FRAMES[frame] : IDLE_ICON;
};

const AgentLine = ({ agent }: { agent: Agent }) => {
  const isBlocked = agent.status === "blocked";
  const spinner = useSpinner(agent.status === "working");
  const icon = isBlocked ? BLOCKED_ICON : spinner;
  const task = agent.sessionTitle
    ? truncate(agent.sessionTitle, MAX_TASK)
    : "untitled";
  const taskColor =
    agent.status === "idle"
      ? COLORS.dim
      : agent.status === "blocked"
        ? COLORS.blocked
        : COLORS.text;

  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      <text style={{ fg: statusColor(agent.status), width: 2 }}>{icon}</text>
      <text style={{ fg: taskColor, flexGrow: 1 }}>{task}</text>
      <text style={{ fg: COLORS.faint }}>{TYPE_ICONS[agent.type]}</text>
      {agent.contextPercent !== null && (
        <text style={{ fg: contextColor(agent.contextPercent) }}>
          {` ${agent.contextPercent}%`}
        </text>
      )}
    </box>
  );
};

interface CheckoutTileProps {
  checkout: Checkout;
  showRepoPath: boolean;
  selected: boolean;
  tileRef?: Ref<BoxRenderable>;
  onActivate: () => void;
}

const CheckoutTile = ({
  checkout,
  showRepoPath,
  selected,
  tileRef,
  onActivate,
}: CheckoutTileProps) => {
  const borderColor = selected
    ? COLORS.sel
    : !checkout.isOpen || checkout.status === "idle"
      ? COLORS.borderDim
      : statusColor(checkout.status);

  const nameText = !showRepoPath
    ? checkout.label
    : checkout.kind === "worktree"
      ? `${checkout.repo}/${checkout.label}`
      : `${checkout.org}/${checkout.dir}`;
  const showBranch =
    checkout.kind === "worktree" || showRepoPath ? checkout.branch : null;
  const pr = getCachedPr(checkout.path, checkout.branch);

  return (
    <box
      ref={tileRef}
      onMouseUp={onActivate}
      style={{
        width: TILE_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <box style={{ flexDirection: "row", height: 1 }}>
        <text style={{ fg: statusColor(checkout.status), width: 2 }}>
          {checkout.marker}
        </text>
        <text style={{ fg: COLORS.text, flexGrow: 1 }}>
          {truncate(nameText, MAX_NAME)}
        </text>
        {checkout.attached && <text style={{ fg: COLORS.attached }}>●</text>}
        {pr ? (
          <>
            <text style={{ fg: prColor(pr.state) }}>
              {` ${GITHUB_ICON} #${pr.number}`}
            </text>
            {pr.checks !== "none" && (
              <text style={{ fg: checkColor(pr.checks) }}>
                {` ${checkGlyph(pr.checks)}`}
              </text>
            )}
            {pr.review === "changes" && (
              <text style={{ fg: COLORS.prClosed }}> !</text>
            )}
            {pr.review === "required" && (
              <text style={{ fg: COLORS.prDraft }}> ?</text>
            )}
          </>
        ) : (
          showBranch && (
            <text style={{ fg: COLORS.faint }}>
              {` ${truncate(showBranch, MAX_BRANCH)}`}
            </text>
          )
        )}
      </box>
      {checkout.isOpen ? (
        checkout.agents.map((agent) => (
          <AgentLine key={agent.target} agent={agent} />
        ))
      ) : (
        <box style={{ flexDirection: "row", height: 1 }}>
          <text style={{ fg: COLORS.work }}>⏎ open worktree</text>
        </box>
      )}
    </box>
  );
};

const RowHeader = ({ row }: { row: RenderRow }) => {
  const repo = row.repo;
  // Count sessions (open checkouts) by status, not agents — matches the tiles.
  const sessions = { blocked: 0, working: 0, idle: 0 };
  for (const checkout of row.checkouts) {
    if (checkout.isOpen) sessions[checkout.status]++;
  }
  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      {row.kind === "disk" ? (
        <text style={{ fg: COLORS.faint }}>not open</text>
      ) : (
        repo && (
          <>
            <text style={{ fg: COLORS.faint }}>{`${repo.org}/`}</text>
            <text style={{ fg: COLORS.text }}>{repo.repo}</text>
            {repo.attached && <text style={{ fg: COLORS.attached }}> ●</text>}
          </>
        )
      )}
      <box style={{ flexGrow: 1 }} />
      {sessions.blocked > 0 && (
        <text style={{ fg: COLORS.blocked }}>{` ◼${sessions.blocked}`}</text>
      )}
      {sessions.working > 0 && (
        <text style={{ fg: COLORS.work }}>{` ⣾${sessions.working}`}</text>
      )}
      {sessions.idle > 0 && (
        <text style={{ fg: COLORS.dim }}>{` •${sessions.idle}`}</text>
      )}
    </box>
  );
};

interface RowViewProps {
  row: RenderRow;
  isSelectedRow: boolean;
  selCol: number;
  lineWidth: number;
  isFirst: boolean;
  rowRef?: Ref<BoxRenderable>;
  tileRef?: Ref<BoxRenderable>;
  onActivate: (col: number) => void;
}

const RowView = ({
  row,
  isSelectedRow,
  selCol,
  lineWidth,
  isFirst,
  rowRef,
  tileRef,
  onActivate,
}: RowViewProps) => (
  <box
    ref={rowRef}
    style={{ flexDirection: "column", marginTop: isFirst ? 0 : 1 }}
  >
    <RowHeader row={row} />
    {/* An explicit width makes wrapping land exactly on `tilesPerLine`, so the
        rendered grid matches what j/k navigate. */}
    <box
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        width: lineWidth,
        columnGap: TILE_GAP,
      }}
    >
      {row.checkouts.map((checkout, col) => (
        <CheckoutTile
          key={checkout.key}
          checkout={checkout}
          showRepoPath={row.kind === "disk"}
          selected={isSelectedRow && col === selCol}
          tileRef={isSelectedRow && col === selCol ? tileRef : undefined}
          onActivate={() => onActivate(col)}
        />
      ))}
    </box>
  </box>
);

interface HeaderProps {
  totals: { agents: number; blocked: number; working: number; idle: number };
}

const Header = ({ totals }: HeaderProps) => (
  <box style={{ flexDirection: "row", height: 1, marginBottom: 1 }}>
    <text style={{ fg: COLORS.work }}>◈ </text>
    <text style={{ fg: COLORS.text }}>agents</text>
    <text style={{ fg: COLORS.faint }}>{`  ${totals.agents}`}</text>
    {totals.blocked > 0 && (
      <text style={{ fg: COLORS.blocked }}>{`  ◼ ${totals.blocked}`}</text>
    )}
    {totals.working > 0 && (
      <text style={{ fg: COLORS.work }}>{`  ⣾ ${totals.working}`}</text>
    )}
    {totals.idle > 0 && (
      <text style={{ fg: COLORS.dim }}>{`  • ${totals.idle}`}</text>
    )}
  </box>
);

interface BlockedItem {
  row: number;
  col: number;
  agent: Agent;
  repo: string;
  label: string;
}

const NEEDS_YOU_MAX = 4;

// A pinned strip of every blocked agent across all repos, so the thing waiting on
// you stays visible even when its tile is scrolled off. Clicking an entry jumps to
// its session; `n` cycles the selection through them.
const NeedsYouBand = ({
  items,
  onActivate,
}: {
  items: BlockedItem[];
  onActivate: (row: number, col: number) => void;
}) => (
  <box style={{ flexDirection: "column", marginBottom: 1 }}>
    <box style={{ flexDirection: "row", height: 1 }}>
      <text style={{ fg: COLORS.blocked }}>▲ needs you </text>
      <text style={{ fg: COLORS.faint }}>{`(${items.length})`}</text>
      <text style={{ fg: COLORS.borderDim }}>{"    n → cycle"}</text>
    </box>
    {items.slice(0, NEEDS_YOU_MAX).map((item) => (
      <box
        key={item.agent.target}
        onMouseUp={() => onActivate(item.row, item.col)}
        style={{ flexDirection: "row", height: 1 }}
      >
        <text style={{ fg: COLORS.blocked }}>◼ </text>
        <text style={{ fg: COLORS.dim }}>{`${item.repo}/${item.label}  `}</text>
        <text style={{ fg: COLORS.text, flexGrow: 1 }}>
          {truncate(item.agent.sessionTitle ?? "untitled", 44)}
        </text>
      </box>
    ))}
    {items.length > NEEDS_YOU_MAX && (
      <box style={{ flexDirection: "row", height: 1 }}>
        <text style={{ fg: COLORS.faint }}>
          {`  …and ${items.length - NEEDS_YOU_MAX} more`}
        </text>
      </box>
    )}
  </box>
);

const Footer = () => (
  <box style={{ flexDirection: "row", marginTop: 1 }}>
    <text style={{ fg: COLORS.faint }}>hjkl</text>
    <text style={{ fg: COLORS.dim }}> move</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.faint }}>⏎</text>
    <text style={{ fg: COLORS.dim }}> open</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.faint }}>n</text>
    <text style={{ fg: COLORS.dim }}> needs-you</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.faint }}>q</text>
    <text style={{ fg: COLORS.dim }}> quit</text>
  </box>
);

const EmptyState = () => (
  <box style={{ flexDirection: "column", flexGrow: 1, marginTop: 1 }}>
    <text style={{ fg: COLORS.dim }}>No agents running</text>
    <box style={{ flexDirection: "row", height: 1, marginTop: 1 }}>
      <text style={{ fg: COLORS.borderDim }}>└ </text>
      <text style={{ fg: COLORS.faint }}>
        start claude, codex, opencode, or pi in tmux
      </text>
    </box>
  </box>
);

const RADAR_FRAMES = ["◜", "◝", "◞", "◟"];

const LoadingState = () => {
  const [scanFrame, setScanFrame] = useState(0);
  const [radarFrame, setRadarFrame] = useState(0);

  const scanWidth = Math.max(20, (process.stdout.columns || 80) - 2);
  const totalFrames = scanWidth + 2;

  useEffect(() => {
    const scanInterval = setInterval(() => {
      setScanFrame((f) => (f + 1) % totalFrames);
    }, LOADER_INTERVAL);
    const radarInterval = setInterval(() => {
      setRadarFrame((f) => (f + 1) % RADAR_FRAMES.length);
    }, 100);
    return () => {
      clearInterval(scanInterval);
      clearInterval(radarInterval);
    };
  }, [totalFrames]);

  const highlightPos = scanFrame - 1;
  const scanLine = Array.from({ length: scanWidth }, (_, j) =>
    j === highlightPos || j === highlightPos + 1 ? "▰" : "▱",
  ).join("");

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <text style={{ fg: COLORS.work }}>{RADAR_FRAMES[radarFrame]} </text>
        <text style={{ fg: COLORS.text }}>Scanning tmux sessions</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, marginTop: 1 }}>
        <text style={{ fg: COLORS.borderDim }}>
          {scanLine.slice(0, Math.max(0, highlightPos))}
        </text>
        <text style={{ fg: COLORS.work }}>
          {scanLine.slice(
            Math.max(0, highlightPos),
            Math.min(scanWidth, highlightPos + 2),
          )}
        </text>
        <text style={{ fg: COLORS.borderDim }}>
          {scanLine.slice(Math.min(scanWidth, highlightPos + 2))}
        </text>
      </box>
    </box>
  );
};

interface AppProps {
  forceLoading?: boolean;
}

export const App = ({ forceLoading = false }: AppProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worktrees, setWorktrees] = useState<
    Awaited<ReturnType<typeof pollDashboard>>["worktrees"]
  >([]);
  const [sel, setSel] = useState<Selection>({ row: 0, col: 0 });
  const [dataLoaded, setDataLoaded] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  // Bumped after a PR refresh to re-render with the freshly cached PR info.
  const [, setPrTick] = useState(0);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const selectedRowRef = useRef<BoxRenderable>(null);
  const selectedTileRef = useRef<BoxRenderable>(null);

  const isLoading = !dataLoaded || !minTimeElapsed;

  const { repos, totals } = groupByRepo({ agents, worktrees });
  const rows = buildRows(repos);
  const rowsSig = rows.map((r) => `${r.key}:${r.checkouts.length}`).join("|");
  const prKeysSig = [
    ...new Set(
      rows.flatMap((r) => r.checkouts).map((c) => `${c.path} ${c.branch ?? ""}`),
    ),
  ].join("|");

  const contentWidth = Math.max(TILE_WIDTH, (width || 80) - 4);
  const perLine = tilesPerLine(contentWidth);
  const lineWidth = lineWidthFor(perLine);

  const blocked: BlockedItem[] = [];
  rows.forEach((row, ri) =>
    row.checkouts.forEach((checkout, ci) =>
      checkout.agents.forEach((agent) => {
        if (agent.status === "blocked") {
          blocked.push({
            row: ri,
            col: ci,
            agent,
            repo: row.repo?.repo ?? checkout.repo,
            label: checkout.label,
          });
        }
      }),
    ),
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setMinTimeElapsed(true),
      MIN_LOADER_DURATION,
    );
    return () => clearTimeout(timer);
  }, []);

  // Look up PRs for the visible checkouts in the background (cached, off the fast
  // poll). Re-runs when the set of checkout branches changes; the interval keeps
  // them fresh past the cache TTL.
  useEffect(() => {
    let cancelled = false;
    const checkouts = rows
      .flatMap((r) => r.checkouts)
      .map((c) => ({ path: c.path, branch: c.branch }));
    const run = async () => {
      await refreshPrs(checkouts);
      if (!cancelled) setPrTick((t) => t + 1);
    };
    run();
    const id = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prKeysSig]);

  useEffect(() => {
    let cancelled = false;
    let pollId = 0;
    let initialSelectionSet = false;

    const poll = async () => {
      const id = ++pollId;
      try {
        const result = await pollDashboard();
        if (cancelled || id !== pollId) return;
        setAgents(result.agents);
        setWorktrees(result.worktrees);
        setDataLoaded(true);

        if (!initialSelectionSet && result.agents.length > 0) {
          initialSelectionSet = true;
          const initialRows = buildRows(
            groupByRepo({
              agents: result.agents,
              worktrees: result.worktrees,
            }).repos,
          );
          for (let r = 0; r < initialRows.length; r++) {
            const c = initialRows[r].checkouts.findIndex((ck) => ck.attached);
            if (c !== -1) {
              setSel({ row: r, col: c });
              break;
            }
          }
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Keep the selection in bounds when the set of rows/checkouts changes.
  useEffect(() => {
    setSel((s) => {
      const next = clampSelection({ sel: s, rows });
      return next.row === s.row && next.col === s.col ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig]);

  // Keep the selection scrolled into view vertically. The bottom edge always
  // follows the selected tile — a repo taller than the viewport must never scroll
  // its own selection off screen — while the top edge reaches up to the repo
  // header as long as the selection sits on the repo's first line.
  useEffect(() => {
    const box = scrollRef.current;
    const row = selectedRowRef.current;
    const target = selectedTileRef.current ?? row;
    if (!box || !target) return;
    const viewTop = box.viewport.y;
    const viewBottom = viewTop + box.viewport.height;
    const top = sel.col < perLine && row ? row.y : target.y;
    const bottom = target.y + target.height;
    if (top < viewTop) box.scrollBy({ x: 0, y: top - viewTop });
    else if (bottom > viewBottom) box.scrollBy({ x: 0, y: bottom - viewBottom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.row, sel.col, perLine, rowsSig]);

  const activate = (row: number, col: number) => {
    setSel({ row, col });
    const checkout = rows[row]?.checkouts[col];
    if (!checkout) return;
    if (!checkout.isOpen) {
      openWorktree(checkout.path);
      return;
    }
    const session = checkout.agents[0]?.session;
    if (session) focusPane(`${session}:${AGENTS_WINDOW}`);
  };

  const quit = () => {
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((key) => {
    // Plain letters arrive as `sequence`, not `name` (which carries arrows/return/etc.).
    const letter = !key.ctrl && !key.meta ? key.sequence : undefined;

    if (key.name === "down" || letter === "j") {
      setSel((s) => moveDown({ sel: s, rows, perLine }));
      return;
    }
    if (key.name === "up" || letter === "k") {
      setSel((s) => moveUp({ sel: s, rows, perLine }));
      return;
    }
    if (key.name === "right" || letter === "l") {
      setSel((s) => moveRight({ sel: s, rows, perLine }));
      return;
    }
    if (key.name === "left" || letter === "h") {
      setSel((s) => moveLeft({ sel: s, rows, perLine }));
      return;
    }
    if (letter === "n") {
      if (blocked.length === 0) return;
      const next =
        blocked.find(
          (b) => b.row > sel.row || (b.row === sel.row && b.col > sel.col),
        ) ?? blocked[0];
      setSel({ row: next.row, col: next.col });
      return;
    }
    if (key.name === "return") {
      activate(sel.row, sel.col);
      return;
    }
    if (letter === "q" || key.name === "escape") {
      quit();
    }
  });

  const isEmpty = agents.length === 0 && worktrees.length === 0;

  return (
    <box style={{ flexDirection: "column", padding: 1, height: "100%" }}>
      <Header totals={totals} />

      {!isLoading && !forceLoading && blocked.length > 0 && (
        <NeedsYouBand items={blocked} onActivate={activate} />
      )}

      {isLoading || forceLoading ? (
        <LoadingState />
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <scrollbox
          ref={scrollRef}
          scrollX={false}
          style={{
            flexGrow: 1,
            scrollbarOptions: {
              showArrows: false,
              trackOptions: {
                foregroundColor: COLORS.work,
                backgroundColor: COLORS.borderDim,
              },
            },
          }}
        >
          <box style={{ flexDirection: "column" }}>
            {rows.map((row, rowIdx) => (
              <RowView
                key={row.key}
                row={row}
                isSelectedRow={rowIdx === sel.row}
                selCol={sel.col}
                lineWidth={lineWidth}
                isFirst={rowIdx === 0}
                rowRef={rowIdx === sel.row ? selectedRowRef : undefined}
                tileRef={rowIdx === sel.row ? selectedTileRef : undefined}
                onActivate={(col) => activate(rowIdx, col)}
              />
            ))}
          </box>
        </scrollbox>
      )}

      <Footer />
    </box>
  );
};
