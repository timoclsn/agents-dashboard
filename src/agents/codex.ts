import type { PaneInfo } from "../tmux/client";

// "esc to interrupt" only shows during active work
const WORKING = /esc to interrupt/i;

export const detectCodex = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("codex");
};

export const detectCodexStatus = (content: string): "idle" | "working" => {
  const lastLines = content.slice(-500);
  if (WORKING.test(lastLines)) return "working";
  return "idle";
};
