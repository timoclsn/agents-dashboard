import type { PaneInfo } from "../tmux/client";

// Content-based patterns (Codex doesn't use title spinners)
const PROCESSING = /thinking|running|executing|generating/i;
const IDLE = /ready|waiting for|what would you like|context left/i;
const IDLE_PROMPT = /›\s*$/m;

export const detectCodex = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("codex");
};

export const detectCodexStatus = (content: string): "idle" | "working" => {
  const lastLines = content.slice(-500);

  if (PROCESSING.test(lastLines)) return "working";
  if (IDLE.test(lastLines)) return "idle";
  if (IDLE_PROMPT.test(lastLines)) return "idle";

  return "working";
};
