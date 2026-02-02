import type { PaneInfo } from "../tmux/client";

// Content-based patterns (OpenCode doesn't use title spinners)
const PROCESSING = /thinking|processing|generating|analyzing|working/i;
const IDLE = /ready|waiting|idle/i;

export const detectOpenCode = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("opencode");
};

export const detectOpenCodeStatus = (content: string): "idle" | "working" => {
  const lastLines = content.slice(-500);

  if (PROCESSING.test(lastLines)) return "working";
  if (IDLE.test(lastLines)) return "idle";

  return "working";
};
