import type { PaneInfo } from "../tmux/client";
import {
  bottomNonEmptyLines,
  STATUS_SCAN_CHARS,
  type AgentStatus,
} from "./detect";

const PI_CMD = /(?:^|[\s/])pi(?:\s|$)/i;

export const detectPi = (pane: PaneInfo) => {
  if (pane.command.toLowerCase() === "pi") return true;
  return pane.childCommands.some(
    (cmd) => PI_CMD.test(cmd) || cmd.toLowerCase().includes("pi-coding-agent"),
  );
};

// Title braille spinner indicates active work (e.g. from titlebar-spinner extension).
const TITLE_WORKING = /^[⠀-⣿]\s/;

// Content working indicators:
// - Editor top border spinner: ── ⠋ Working ──
// - Status line: ⠋ Working... / Working... (escape to interrupt)
// - Compacting / retrying / summarizing indicators
const WORKING =
  /[⠀-⣿]\s*(?:working|compacting|auto-compacting|retrying|summarizing)|\bworking…|\bworking\.\.\.|(?:esc(?:ape)?\b.*to interrupt)|(?:\bto cancel\b)/i;

// Blocked indicators in the bottom lines of pane content:
// - Confirmation / selector dialogs (ExtensionSelectorComponent, TrustSelectorComponent, etc.)
// - Input prompts (ExtensionInputComponent)
// - Approval prompts (allow command?, [y/n], etc.)
const BLOCKED =
  /↑↓\s*navigate|enter\s+(?:select|confirm|submit|save)|(?:press\s+enter\s+to\s+confirm|allow\s+command\?|\[y\/n\]|\(y\/n\))/i;

export const detectPiStatus = (
  title: string,
  content: string,
): AgentStatus => {
  if (TITLE_WORKING.test(title)) return "working";
  if (BLOCKED.test(bottomNonEmptyLines(content, 8))) return "blocked";
  if (WORKING.test(content.slice(-STATUS_SCAN_CHARS))) return "working";
  return "idle";
};

// Pi terminal title format:
// "π - <sessionName> - <cwdBasename>" or "π - <cwdBasename>"
// With optional braille spinner: "⠋ π - <sessionName> - <cwdBasename>"
// APP_TITLE may also be "pi" instead of "π".
const TITLE_PATTERN = /^(?:[⠀-⣿]\s+)?(?:π|pi)\s+-\s+(.+)$/i;

export const parsePiSessionTitle = (
  title: string,
  content?: string,
) => {
  const match = title.match(TITLE_PATTERN);
  if (match) {
    const parts = match[1].split(" - ");
    if (parts.length >= 2) {
      const sessionName = parts.slice(0, -1).join(" - ").trim();
      if (sessionName.length > 0) return sessionName;
    }
  }

  // Fallback: check the footer pwd line in content, which renders as "<pwd> • <sessionName>"
  if (content) {
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      const footerMatch = line.match(/^[~/][^•\n]*\s+•\s+(.+)$/);
      if (footerMatch) {
        const name = footerMatch[1].trim();
        if (name.length > 0) return name;
      }
    }
  }

  return null;
};

// Pi footer displays context window usage as "<percent>%/<total>" (e.g. "21.4%/1.0M (auto)").
const CONTEXT_USAGE = /(\d+(?:\.\d+)?)%\s*\/\s*[\d.]+[kmg]?/gi;

export const parsePiContext = (content: string) => {
  const matches = [...content.matchAll(CONTEXT_USAGE)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const used = Math.round(parseFloat(last[1]));
  if (Number.isNaN(used)) return null;
  return Math.min(100, Math.max(0, used));
};
