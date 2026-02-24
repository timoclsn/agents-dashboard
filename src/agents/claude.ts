import type { PaneInfo } from "../tmux/client";
import { STATUS_SCAN_CHARS } from "./detect";

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
  const lastLines = content.slice(-STATUS_SCAN_CHARS);
  if (WORKING.test(lastLines)) {
    return "working";
  }
  return "idle";
};

// Parse session title from the status line. The title is the last pipe-separated
// segment when there are 5+ segments (model | context | changes | project | title)
const STATUS_LINE_PATTERN = /^\s*(?:\S+\s+\S+)\s*\|.*\|.*\|.*\|\s*(.+?)\s*$/;

export const parseClaudeSessionTitle = (content: string): string | null => {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = STATUS_LINE_PATTERN.exec(lines[i]);
    if (match) {
      return match[1];
    }
  }
  return null;
};
