import type { Agent, AgentStatus } from "./detect";
import type { Worktree } from "../worktrees/scan";

// Infix the /worktree skill uses to mark a linked worktree dir (e.g. `repo-w-feature`).
const WORKTREE_INFIX = "-w-";
const BASE_MARKER = "◆";
const WORKTREE_MARKER = "⎇";

export type CheckoutKind = "base" | "worktree";

// A single git checkout on disk — either the base repo clone or a linked worktree —
// holding the agents running inside it. A worktree/base with no live session is `isOpen: false`.
export interface Checkout {
  key: string;
  path: string;
  org: string;
  repo: string;
  dir: string;
  kind: CheckoutKind;
  label: string;
  branch: string | null;
  marker: string;
  agents: Agent[];
  status: AgentStatus;
  attached: boolean;
  isOpen: boolean;
}

// All checkouts (base + worktrees) that share one base repo.
export interface RepoGroup {
  key: string;
  org: string;
  repo: string;
  checkouts: Checkout[];
  status: AgentStatus;
  hasOpenAgents: boolean;
  openCheckoutCount: number;
  attached: boolean;
  agentCount: number;
  counts: { blocked: number; working: number; idle: number };
}

export interface GroupedDashboard {
  repos: RepoGroup[];
  totals: {
    agents: number;
    blocked: number;
    working: number;
    idle: number;
    openCheckouts: number;
    repos: number;
    diskOnly: number;
  };
}

interface ParsedLocation {
  org: string;
  dir: string;
  checkoutPath: string;
}

// Map a pane's current path back to its checkout root, following the
// ~/Developer/<org>/<checkout> convention (scan.ts uses the same layout). A pane
// cd'd into a subdir of the checkout still resolves to the checkout root.
const parseLocation = (path: string): ParsedLocation => {
  const parts = path.split("/").filter(Boolean);
  const devIdx = parts.lastIndexOf("Developer");
  if (devIdx !== -1 && parts.length >= devIdx + 3) {
    return {
      org: parts[devIdx + 1],
      dir: parts[devIdx + 2],
      checkoutPath: "/" + parts.slice(0, devIdx + 3).join("/"),
    };
  }
  return {
    org: parts[parts.length - 2] ?? "",
    dir: parts[parts.length - 1] ?? path,
    checkoutPath: path,
  };
};

const splitRepo = (
  dir: string,
): { repo: string; kind: CheckoutKind; suffix: string | null } => {
  const idx = dir.indexOf(WORKTREE_INFIX);
  if (idx === -1) return { repo: dir, kind: "base", suffix: null };
  return {
    repo: dir.slice(0, idx),
    kind: "worktree",
    suffix: dir.slice(idx + WORKTREE_INFIX.length),
  };
};

const aggregateStatus = (agents: Agent[]): AgentStatus => {
  if (agents.some((a) => a.status === "blocked")) return "blocked";
  if (agents.some((a) => a.status === "working")) return "working";
  return "idle";
};

// Build the repo → checkout → agent tree used by the TUI. Open checkouts come
// from live agent panes; closed ones from the on-disk worktree scan. Ordering is
// stable and predictable: repos alphabetical, checkouts alphabetical with the base
// (`main`) first and not-open worktrees trailing, agents in window/pane order.
// State is conveyed by colour, not position, so tiles never jump around.
export const groupByRepo = ({
  agents,
  worktrees,
}: {
  agents: Agent[];
  worktrees: Worktree[];
}): GroupedDashboard => {
  const checkouts = new Map<string, Checkout>();

  for (const agent of agents) {
    const { org, dir, checkoutPath } = parseLocation(agent.path);
    let checkout = checkouts.get(checkoutPath);
    if (!checkout) {
      const { repo, kind, suffix } = splitRepo(dir);
      checkout = {
        key: checkoutPath,
        path: checkoutPath,
        org,
        repo,
        dir,
        kind,
        label: kind === "worktree" ? (suffix ?? dir) : (agent.gitBranch ?? dir),
        branch: agent.gitBranch,
        marker: kind === "worktree" ? WORKTREE_MARKER : BASE_MARKER,
        agents: [],
        status: "idle",
        attached: false,
        isOpen: true,
      };
      checkouts.set(checkoutPath, checkout);
    }
    checkout.agents.push(agent);
  }

  for (const worktree of worktrees) {
    if (checkouts.has(worktree.path)) continue;
    const { repo, kind, suffix } = splitRepo(worktree.name);
    checkouts.set(worktree.path, {
      key: worktree.path,
      path: worktree.path,
      org: worktree.org,
      repo,
      dir: worktree.name,
      kind,
      label:
        kind === "worktree"
          ? (suffix ?? worktree.name)
          : (worktree.gitBranch ?? worktree.name),
      branch: worktree.gitBranch,
      marker: kind === "worktree" ? WORKTREE_MARKER : BASE_MARKER,
      agents: [],
      status: "idle",
      attached: false,
      isOpen: false,
    });
  }

  for (const checkout of checkouts.values()) {
    checkout.agents.sort((a, b) => a.window - b.window || a.pane - b.pane);
    checkout.status = aggregateStatus(checkout.agents);
    checkout.attached = checkout.agents.some((a) => a.attached);
  }

  const repos = new Map<string, RepoGroup>();
  for (const checkout of checkouts.values()) {
    const key = `${checkout.org}/${checkout.repo}`;
    let repo = repos.get(key);
    if (!repo) {
      repo = {
        key,
        org: checkout.org,
        repo: checkout.repo,
        checkouts: [],
        status: "idle",
        hasOpenAgents: false,
        openCheckoutCount: 0,
        attached: false,
        agentCount: 0,
        counts: { blocked: 0, working: 0, idle: 0 },
      };
      repos.set(key, repo);
    }
    repo.checkouts.push(checkout);
  }

  for (const repo of repos.values()) {
    repo.checkouts.sort(
      (a, b) =>
        Number(b.isOpen) - Number(a.isOpen) ||
        Number(a.kind === "worktree") - Number(b.kind === "worktree") ||
        a.label.localeCompare(b.label),
    );
    const openAgents = repo.checkouts
      .filter((c) => c.isOpen)
      .flatMap((c) => c.agents);
    for (const agent of openAgents) repo.counts[agent.status]++;
    repo.agentCount = openAgents.length;
    repo.openCheckoutCount = repo.checkouts.filter((c) => c.isOpen).length;
    repo.hasOpenAgents = openAgents.length > 0;
    repo.attached = repo.checkouts.some((c) => c.attached);
    repo.status = aggregateStatus(openAgents);
  }

  const sortedRepos = Array.from(repos.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const totals = {
    agents: 0,
    blocked: 0,
    working: 0,
    idle: 0,
    openCheckouts: 0,
    repos: 0,
    diskOnly: 0,
  };
  for (const repo of sortedRepos) {
    totals.agents += repo.agentCount;
    totals.blocked += repo.counts.blocked;
    totals.working += repo.counts.working;
    totals.idle += repo.counts.idle;
    totals.openCheckouts += repo.openCheckoutCount;
    if (repo.hasOpenAgents) totals.repos++;
    totals.diskOnly += repo.checkouts.filter((c) => !c.isOpen).length;
  }

  return { repos: sortedRepos, totals };
};
