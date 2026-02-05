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

// Parse session title from status line like:
// Opus 4.5 | 74k/200k (37%) | +104/-4 | project:branch | "Session Title Here"
const SESSION_TITLE_PATTERN = /\|\s*"([^"]+)"\s*$/;

export const parseClaudeSessionTitle = (content: string): string | null => {
  const lines = content.split("\n");
  // Search from bottom up for the status line with quoted title
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = SESSION_TITLE_PATTERN.exec(line);
    if (match) {
      return match[1];
    }
  }
  return null;
};
