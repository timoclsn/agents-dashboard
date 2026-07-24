import type { PaneInfo } from "../tmux/client";

export type AgentType = "claude" | "codex" | "opencode" | "unknown";
export type AgentStatus = "idle" | "working" | "blocked";

// How many characters from the end of pane content to check for status indicators
export const STATUS_SCAN_CHARS = 1000;

// The last `count` non-empty lines of pane content, joined. Scoping matches to
// the visible bottom of the screen avoids false positives from scrollback.
export const bottomNonEmptyLines = (content: string, count: number): string => {
  const lines = content.split("\n");
  const picked: string[] = [];
  for (let i = lines.length - 1; i >= 0 && picked.length < count; i--) {
    if (lines[i].trim().length > 0) picked.unshift(lines[i]);
  }
  return picked.join("\n");
};

export interface Agent {
  target: string;
  session: string;
  sessionId: number;
  window: number;
  pane: number;
  type: AgentType;
  status: AgentStatus;
  path: string;
  gitBranch: string | null;
  sessionTitle: string | null;
  attached: boolean;
  // Percentage of context window remaining (Claude only; null otherwise).
  contextPercent: number | null;
}
import {
  listPanes,
  capturePane,
  capturePaneTop,
  getGitBranch,
} from "../tmux/client";
import {
  detectClaude,
  detectClaudeStatus,
  parseClaudeSessionTitle,
  parseClaudeContext,
} from "./claude";
import {
  detectCodex,
  detectCodexStatus,
  parseCodexSessionTitle,
} from "./codex";
import {
  detectOpenCode,
  detectOpenCodeStatus,
  parseOpenCodeSessionTitle,
} from "./opencode";
import { scanWorktrees, type Worktree } from "../worktrees/scan";

// Fallback prompt patterns for all agents
const FALLBACK_PROMPTS = [/❯\s*$/m, /›\s*$/m, /^>\s*$/m, /\$\s*$/m];
const GIT_BRANCH_TTL_MS = 5_000;

interface CacheEntry<T> {
  value: T;
  updatedAt: number;
}

const gitBranchCache = new Map<string, CacheEntry<string | null>>();

const parseSessionTitle = ({
  pane,
  content,
  topContent,
  agentType,
}: {
  pane: PaneInfo;
  content: string;
  topContent: string;
  agentType: AgentType;
}): string | null => {
  if (agentType === "claude") {
    return parseClaudeSessionTitle(pane.title);
  }
  if (agentType === "codex") {
    return parseCodexSessionTitle(content);
  }
  if (agentType === "opencode") {
    return parseOpenCodeSessionTitle(topContent);
  }
  return null;
};

const detectAgentType = (pane: PaneInfo): AgentType | null => {
  if (detectClaude(pane)) return "claude";
  if (detectCodex(pane)) return "codex";
  if (detectOpenCode(pane)) return "opencode";
  return null;
};

const detectStatus = (
  pane: PaneInfo,
  content: string,
  agentType: AgentType,
): AgentStatus => {
  // Agent-specific detection
  if (agentType === "claude") {
    return detectClaudeStatus(pane.title, content);
  }
  if (agentType === "codex") {
    return detectCodexStatus(pane.title, content);
  }
  if (agentType === "opencode") {
    return detectOpenCodeStatus(content);
  }

  // Fallback: check for prompt patterns
  const lastLines = content.slice(-500);
  for (const pattern of FALLBACK_PROMPTS) {
    if (pattern.test(lastLines)) {
      return "idle";
    }
  }

  // Check if last non-empty line is just a prompt character
  const trimmedLines = lastLines.split("\n").filter((l) => l.trim().length > 0);
  const lastNonEmpty = trimmedLines[trimmedLines.length - 1]?.trim() || "";
  if (["❯", "›", ">", "$"].includes(lastNonEmpty)) {
    return "idle";
  }

  return content.trim().length > 0 ? "working" : "idle";
};

export interface DashboardState {
  agents: Agent[];
  worktrees: Worktree[];
}

const buildAgents = async (panes: PaneInfo[]): Promise<Agent[]> => {
  const agents: Agent[] = [];

  const agentPanes = panes.filter((pane) => detectAgentType(pane) !== null);

  const uniquePaths = [...new Set(agentPanes.map((p) => p.path))];
  const branchMap = new Map<string, string | null>();
  const now = Date.now();
  const pathsToRefresh = uniquePaths.filter((path) => {
    const cached = gitBranchCache.get(path);
    if (!cached) return true;
    if (now - cached.updatedAt >= GIT_BRANCH_TTL_MS) return true;
    branchMap.set(path, cached.value);
    return false;
  });

  await Promise.all(
    pathsToRefresh.map(async (path) => {
      const value = await getGitBranch(path);
      gitBranchCache.set(path, { value, updatedAt: Date.now() });
      branchMap.set(path, value);
    }),
  );

  for (const pane of agentPanes) {
    const agentType = detectAgentType(pane)!;
    const target = `${pane.session}:${pane.window}.${pane.pane}`;
    const content = await capturePane(target);
    const topContent =
      agentType === "opencode" ? await capturePaneTop(target) : "";

    const status = detectStatus(pane, content, agentType);

    agents.push({
      target,
      session: pane.session,
      sessionId: pane.sessionId,
      window: pane.window,
      pane: pane.pane,
      type: agentType,
      status,
      path: pane.path,
      gitBranch: branchMap.get(pane.path) ?? null,
      sessionTitle: parseSessionTitle({ pane, content, topContent, agentType }),
      attached: pane.attached,
      contextPercent:
        agentType === "claude" ? parseClaudeContext(content) : null,
    });
  }

  return agents;
};

export const pollAgents = async (): Promise<Agent[]> => {
  const panes = await listPanes();
  return buildAgents(panes);
};

export const pollDashboard = async (): Promise<DashboardState> => {
  const panes = await listPanes();
  const [agents, worktrees] = await Promise.all([
    buildAgents(panes),
    scanWorktrees(new Set(panes.map((pane) => pane.path))),
  ]);
  return { agents, worktrees };
};
