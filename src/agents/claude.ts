import type { PaneInfo } from "../tmux/client";

// Spinner characters in title indicate working
const SPINNER_CHARS = /[⠿⠇⠋⠙⠸⠴⠦⠧⠖⠏⠹⠼⠷⠾⠽⠻⠐⠑⠒⠓▶►]/;

// Prompt patterns for idle detection
const IDLE_PROMPT = /❯\s*$/m;

export const detectClaude = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("claude");
};

export const detectClaudeStatus = (
  title: string,
  content: string,
): "idle" | "working" => {
  // Claude uses spinner in title for working state
  if (SPINNER_CHARS.test(title)) {
    return "working";
  }

  // Check for idle prompt
  const lastLines = content.slice(-500);
  if (IDLE_PROMPT.test(lastLines)) {
    return "idle";
  }

  return "working";
};
