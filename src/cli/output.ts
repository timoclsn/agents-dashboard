import { pollDashboard, type Agent, type DashboardState } from "../agents/detect";
import type { Worktree } from "../worktrees/scan";
import { debugListPanes } from "../tmux/client";

const TYPE_ICONS: Record<Agent["type"], string> = {
  claude: "◆",
  codex: "◇",
  opencode: "○",
  unknown: "?",
};

const STATUS_ICONS: Record<Agent["status"], string> = {
  idle: "⏸",
  working: "▶",
};

const truncate = (str: string, maxLen: number): string => {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
};

const formatAgent = (agent: Agent): string => {
  const attachedIcon = agent.attached ? "▸" : " ";
  const typeIcon = TYPE_ICONS[agent.type];
  const statusIcon = STATUS_ICONS[agent.status];
  const project = agent.path.split("/").pop() || agent.path;
  const title = agent.sessionTitle
    ? truncate(agent.sessionTitle, 30)
    : "untitled";

  return `${attachedIcon} ${statusIcon} ${typeIcon} ${agent.type.padEnd(8)}  ${agent.target.padEnd(20)}  ${project}  ${title}`;
};

const formatWorktree = (worktree: Worktree): string => {
  const branch = worktree.gitBranch ? ` :${worktree.gitBranch}` : "";
  return `  ⎇ ${worktree.org}/${worktree.name}${branch}`;
};

const printState = ({ agents, worktrees }: DashboardState) => {
  console.clear();
  console.log("Agents Dashboard (CLI mode)\n");

  if (agents.length === 0) {
    console.log("No agents detected...\n");
  } else {
    console.log(
      `  ${"ST".padEnd(2)} ${"T".padEnd(1)} ${"TYPE".padEnd(8)} ${"TARGET".padEnd(20)} PROJECT`,
    );
    console.log("-".repeat(62));

    for (const agent of agents) {
      console.log(formatAgent(agent));
    }

    console.log(`\nTotal: ${agents.length} agent(s)`);
  }

  if (worktrees.length > 0) {
    console.log(`\nWorktrees (not open): ${worktrees.length}`);
    for (const worktree of worktrees) {
      console.log(formatWorktree(worktree));
    }
  }
};

interface CliOptions {
  watch?: boolean;
  debug?: boolean;
}

export const runCli = async ({ watch = false, debug = false }: CliOptions) => {
  if (debug) {
    console.log("=== DEBUG: Raw pane data ===\n");
    await debugListPanes();
    console.log("\n=== Detected agents ===\n");
  }

  const state = await pollDashboard();
  printState(state);

  if (watch) {
    console.log("\nWatching for changes (Ctrl+C to exit)...\n");

    let pollId = 0;
    // Allow overlapping polls, but only apply the latest result.
    const interval = setInterval(() => {
      const id = ++pollId;
      pollDashboard()
        .then((updated) => {
          if (id === pollId) {
            printState(updated);
          }
        })
        .catch(() => {});
    }, 1000);
    void interval;
  }
};
