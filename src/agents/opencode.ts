import type { PaneInfo } from "../tmux/client";
import { STATUS_SCAN_CHARS } from "./detect";

// "esc interrupt" only shows during active work
const WORKING = /esc interrupt/i;

export const detectOpenCode = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("opencode");
};

export const detectOpenCodeStatus = (content: string): "idle" | "working" => {
  const lastLines = content.slice(-STATUS_SCAN_CHARS);
  if (WORKING.test(lastLines)) return "working";
  return "idle";
};

// OpenCode shows the session title in two possible formats:
// With sidebar:    "  ┃                                    Session Title"
// Without sidebar: "  ┃  # Session Title                   12,719  10% ($0.00)"
export const parseOpenCodeSessionTitle = (content: string): string | null => {
  const lines = content.split("\n");

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];

    // Without sidebar: title after "# " followed by stats
    const noSidebarMatch = /┃\s+#\s+(.+?)\s{5,}\d/.exec(line);
    if (noSidebarMatch) {
      return noSidebarMatch[1].trim();
    }

    // With sidebar: title at far right after lots of whitespace
    const sidebarMatch = /┃\s{10,}(.+?)\s*$/.exec(line);
    if (sidebarMatch) {
      return sidebarMatch[1].trim();
    }
  }
  return null;
};
