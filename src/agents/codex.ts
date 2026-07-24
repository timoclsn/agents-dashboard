import type { PaneInfo } from "../tmux/client";
import { STATUS_SCAN_CHARS, type AgentStatus } from "./detect";

// Codex encodes state in the terminal title (tmux #{pane_title}): a braille
// spinner while working, "Action Required" when it needs the user.
const TITLE_WORKING = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const TITLE_BLOCKED = /action required/i;

// Content fallbacks for when the title carries no state.
// "esc to interrupt" only shows during active work.
const WORKING = /esc to interrupt/i;
const BLOCKED =
  /press enter to confirm or esc to cancel|allow command\?|enter to submit answer|\[y\/n\]/i;

export const detectCodex = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("codex");
};

export const detectCodexStatus = (
  title: string,
  content: string,
): AgentStatus => {
  if (TITLE_BLOCKED.test(title)) return "blocked";
  if (TITLE_WORKING.test(title)) return "working";
  const lastLines = content.slice(-STATUS_SCAN_CHARS);
  if (BLOCKED.test(lastLines)) return "blocked";
  if (WORKING.test(lastLines)) return "working";
  return "idle";
};

// Codex shows user prompts after "›"
// Use the last submitted user prompt as the session "title"
// Skip the current input line (last › line with no response after it)
export const parseCodexSessionTitle = (content: string): string | null => {
  const lines = content.split("\n");
  const prompts: { index: number; text: string }[] = [];

  // Find all prompt lines
  for (let i = 0; i < lines.length; i++) {
    const match = /^›\s+(.+)/.exec(lines[i]);
    if (match) {
      prompts.push({ index: i, text: match[1].trim() });
    }
  }

  if (prompts.length === 0) return null;

  // Check if the last prompt has a response (• line) after it
  // If not, it's the current input - use the second to last
  const lastPrompt = prompts[prompts.length - 1];
  const hasResponse = lines
    .slice(lastPrompt.index + 1)
    .some((line) => line.startsWith("•"));

  if (hasResponse) {
    return lastPrompt.text;
  }

  // Use second to last prompt if available
  if (prompts.length >= 2) {
    return prompts[prompts.length - 2].text;
  }

  return null;
};
