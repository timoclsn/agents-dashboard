import { describe, expect, test } from "bun:test";
import { groupByRepo } from "./group";
import type { Agent, AgentStatus } from "./detect";
import type { Worktree } from "../worktrees/scan";

interface MockAgentOptions {
  path: string;
  status?: AgentStatus;
  branch?: string | null;
  window?: number;
  pane?: number;
  attached?: boolean;
  title?: string | null;
}

const mockAgent = ({
  path,
  status = "idle",
  branch = "main",
  window = 3,
  pane = 1,
  attached = false,
  title = null,
}: MockAgentOptions): Agent => ({
  target: `sess:${window}.${pane}`,
  session: "sess",
  sessionId: 1,
  window,
  pane,
  type: "claude",
  status,
  path,
  gitBranch: branch,
  sessionTitle: title,
  attached,
  contextPercent: null,
});

const DEV = "/Users/timo/Developer";

describe("groupByRepo", () => {
  test("groups a repo's base and worktrees under one repo", () => {
    const { repos } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, branch: "main" }),
        mockAgent({
          path: `${DEV}/taxfix/ei-mono-w-product-naming`,
          branch: "feat/product-naming",
        }),
      ],
      worktrees: [],
    });

    expect(repos).toHaveLength(1);
    const eiMono = repos[0];
    expect(eiMono.key).toBe("taxfix/ei-mono");
    expect(eiMono.checkouts).toHaveLength(2);
    expect(eiMono.checkouts.map((c) => c.kind).sort()).toEqual([
      "base",
      "worktree",
    ]);
  });

  test("repos are sorted alphabetically by org/repo", () => {
    const { repos } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/tech-platform` }),
        mockAgent({ path: `${DEV}/personal/dotfiles` }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono` }),
      ],
      worktrees: [],
    });

    expect(repos.map((r) => r.key)).toEqual([
      "personal/dotfiles",
      "taxfix/ei-mono",
      "taxfix/tech-platform",
    ]);
  });

  test("checkouts sort base (main) first, then worktrees alphabetically", () => {
    const { repos } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/ei-mono-w-product-naming` }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono-w-bot-restrictions` }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, branch: "main" }),
      ],
      worktrees: [],
    });

    expect(repos[0].checkouts.map((c) => c.label)).toEqual([
      "main",
      "bot-restrictions",
      "product-naming",
    ]);
  });

  test("agents in a checkout keep a stable window/pane order, not status order", () => {
    const { repos } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, status: "idle", pane: 2 }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, status: "blocked", pane: 1 }),
      ],
      worktrees: [],
    });

    const agents = repos[0].checkouts[0].agents;
    expect(agents.map((a) => a.pane)).toEqual([1, 2]);
  });

  test("a pane in a subdirectory resolves to the checkout root", () => {
    const { repos } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/ei-mono/packages/api` }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, pane: 2 }),
      ],
      worktrees: [],
    });

    expect(repos).toHaveLength(1);
    expect(repos[0].checkouts).toHaveLength(1);
    expect(repos[0].checkouts[0].agents).toHaveLength(2);
  });

  test("a closed worktree attaches to its repo as a not-open checkout", () => {
    const worktree: Worktree = {
      path: `${DEV}/taxfix/ei-mono-w-ai-accountant`,
      name: "ei-mono-w-ai-accountant",
      org: "taxfix",
      gitBranch: "feat/ai-accountant-flow",
    };
    const { repos } = groupByRepo({
      agents: [mockAgent({ path: `${DEV}/taxfix/ei-mono`, branch: "main" })],
      worktrees: [worktree],
    });

    expect(repos).toHaveLength(1);
    const closed = repos[0].checkouts.find((c) => !c.isOpen);
    expect(closed?.label).toBe("ai-accountant");
    expect(closed?.agents).toHaveLength(0);
    expect(repos[0].openCheckoutCount).toBe(1);
  });

  test("a repo with only closed worktrees is reported as disk-only", () => {
    const { repos, totals } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/personal/agents-dashboard`, status: "idle" }),
      ],
      worktrees: [
        {
          path: `${DEV}/taxfix/some-repo-w-feature`,
          name: "some-repo-w-feature",
          org: "taxfix",
          gitBranch: "feat/feature",
        },
      ],
    });

    const diskOnly = repos.find((r) => !r.hasOpenAgents);
    expect(diskOnly?.key).toBe("taxfix/some-repo");
    expect(totals.diskOnly).toBe(1);
    expect(totals.repos).toBe(1);
  });

  test("counts agents by status across the board", () => {
    const { totals } = groupByRepo({
      agents: [
        mockAgent({ path: `${DEV}/taxfix/ei-mono-w-a`, status: "blocked" }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono-w-b`, status: "working" }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, status: "idle", pane: 1 }),
        mockAgent({ path: `${DEV}/taxfix/ei-mono`, status: "idle", pane: 2 }),
      ],
      worktrees: [],
    });

    expect(totals.agents).toBe(4);
    expect(totals.blocked).toBe(1);
    expect(totals.working).toBe(1);
    expect(totals.idle).toBe(2);
  });
});
