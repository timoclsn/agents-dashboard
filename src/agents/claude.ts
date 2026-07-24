import type { PaneInfo } from "../tmux/client";
import {
  bottomNonEmptyLines,
  STATUS_SCAN_CHARS,
  type AgentStatus,
} from "./detect";

// Claude Code sets the terminal title (exposed by tmux as #{pane_title}) to
// encode both its state and the current task, e.g. "⠋ Refactor auth" while
// working, "✳ Refactor auth" when idle. The leading glyph is a braille spinner
// (U+2800–U+28FF) while working and ✳ (U+2733) when idle.
const TITLE_WORKING = /^[⠀-⣿]\s/;
const TITLE_IDLE = /^✳\s/;
const TITLE_GLYPH = /^[⠀-⣿✳]\s+/;
const DEFAULT_TITLE = "Claude Code";

// A permission/confirmation prompt means Claude is waiting on the user. The
// interactive prompt always renders a numbered selector ("❯ 1. Yes"); keying on
// that line avoids matching the agent's own prose like "…proceed? If yes, …".
const BLOCKED = /^\s*❯?\s*1\.\s*yes\b/im;

// Fallback content scan for when the title carries no state glyph.
const WORKING = /[·✢✳✶✻✽*]\s*\w+…|Running…/;

export const detectClaude = (pane: PaneInfo): boolean => {
  const childCmdsLower = pane.childCommands
    .map((c) => c.toLowerCase())
    .join(" ");
  return childCmdsLower.includes("claude");
};

export const detectClaudeStatus = (
  title: string,
  content: string,
): AgentStatus => {
  // An active spinner in the title is the strongest signal: it beats any
  // prompt-like text left in the scrollback.
  if (TITLE_WORKING.test(title)) return "working";
  if (BLOCKED.test(bottomNonEmptyLines(content, 8))) return "blocked";
  if (TITLE_IDLE.test(title)) return "idle";
  return WORKING.test(content.slice(-STATUS_SCAN_CHARS)) ? "working" : "idle";
};

// Claude Code's statusline prints the context window as "<used>/<total> (<n>%)"
// (see the user's statusline.ts), where n is the percentage *used*. Return that
// used percentage (matching Claude Code), or null when no statusline is on screen.
const CONTEXT_USAGE = /\/\s*[\d.]+[kmg]?\s*\((\d{1,3})%\)/gi;

export const parseClaudeContext = (content: string): number | null => {
  const matches = [...content.matchAll(CONTEXT_USAGE)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const used = parseInt(last[1], 10);
  if (Number.isNaN(used)) return null;
  return Math.min(100, Math.max(0, used));
};

// Fallback title when Claude hasn't set an OSC task title: the statusline prints
// the session name (custom title / summary / first prompt) as its trailing
// " | <session>" field. Fields before it (model | context | lines | project) are
// fixed, so anything past the 4th separator is the session name.
const STATUSLINE_SEP = " | ";
const CONTEXT_LINE = /\/\s*[\d.]+[kmg]?\s*\(\d{1,3}%\)/i;
const STATUSLINE_FIELDS = 5;

export const parseClaudeStatuslineTitle = (content: string): string | null => {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!CONTEXT_LINE.test(lines[i])) continue;
    const fields = lines[i].trim().split(STATUSLINE_SEP);
    if (fields.length < STATUSLINE_FIELDS) return null;
    return fields.slice(STATUSLINE_FIELDS - 1).join(STATUSLINE_SEP).trim() || null;
  }
  return null;
};

// The title (from #{pane_title}) carries the task; strip the leading state
// glyph. Claude's default "Claude Code" title means no task is set yet.
export const parseClaudeSessionTitle = (title: string): string | null => {
  // Only trust titles Claude authored: those carry a leading state glyph. A
  // bare shell/hostname title (e.g. before Claude sets one) is not a task.
  if (!TITLE_GLYPH.test(title)) return null;
  const stripped = title.replace(TITLE_GLYPH, "").trim();
  if (!stripped || stripped === DEFAULT_TITLE) return null;
  return stripped;
};
