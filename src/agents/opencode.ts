import type { PaneInfo } from "../tmux/client";

// "esc interrupt" only shows during active work
const WORKING = /esc interrupt/i;

export const detectOpenCode = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("opencode");
};

export const detectOpenCodeStatus = (content: string): "idle" | "working" => {
  const lastLines = content.slice(-500);
  if (WORKING.test(lastLines)) return "working";
  return "idle";
};
