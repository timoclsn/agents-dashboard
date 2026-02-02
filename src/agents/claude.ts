import type { PaneInfo } from "../tmux/client";

// Working indicators in content:
// - Status line: "· Scampering…", "✽ Pontificating…", etc.
// - Command running: "Running…" or "⎿  Running…"
const WORKING = /[·✢✳✶✻✽*]\s*\w+…|Running…/;

export const detectClaude = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("claude");
};

export const detectClaudeStatus = (
  _title: string,
  content: string,
): "idle" | "working" => {
  const lastLines = content.slice(-500);
  if (WORKING.test(lastLines)) {
    return "working";
  }
  return "idle";
};
