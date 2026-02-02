import type { PaneInfo } from "../tmux/client";

export type AgentType = "claude" | "codex" | "opencode" | "unknown";
export type AgentStatus = "idle" | "working";

export interface Agent {
  target: string;
  session: string;
  window: number;
  pane: number;
  type: AgentType;
  status: AgentStatus;
  path: string;
  attached: boolean;
}
import { listPanes, capturePane } from "../tmux/client";
import { detectClaude, detectClaudeStatus } from "./claude";
import { detectCodex, detectCodexStatus } from "./codex";
import { detectOpenCode, detectOpenCodeStatus } from "./opencode";

// Fallback prompt patterns for all agents
const FALLBACK_PROMPTS = [/❯\s*$/m, /›\s*$/m, /^>\s*$/m, /\$\s*$/m];

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
    return detectCodexStatus(content);
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

export const pollAgents = async (): Promise<Agent[]> => {
  const panes = await listPanes();
  const agents: Agent[] = [];

  for (const pane of panes) {
    const agentType = detectAgentType(pane);
    if (!agentType) continue;

    const target = `${pane.session}:${pane.window}.${pane.pane}`;
    const content = await capturePane(target);

    agents.push({
      target,
      session: pane.session,
      window: pane.window,
      pane: pane.pane,
      type: agentType,
      status: detectStatus(pane, content, agentType),
      path: pane.path,
      attached: pane.attached,
    });
  }

  return agents.sort((a, b) => a.target.localeCompare(b.target));
};
