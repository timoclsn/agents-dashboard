import { describe, expect, test } from "bun:test";
import {
  detectClaude,
  detectClaudeStatus,
  parseClaudeSessionTitle,
  parseClaudeStatuslineTitle,
  parseClaudeContext,
} from "./claude";
import { detectCodex, detectCodexStatus } from "./codex";
import { detectOpenCode, detectOpenCodeStatus } from "./opencode";
import {
  detectPi,
  detectPiStatus,
  parsePiSessionTitle,
  parsePiContext,
} from "./pi";
import type { PaneInfo } from "../tmux/client";

const mockPane = (childCommands: string[]): PaneInfo => ({
  session: "test",
  sessionId: 1,
  window: 1,
  pane: 1,
  title: "test",
  command: "zsh",
  path: "/tmp",
  pid: 1234,
  attached: false,
  childCommands,
});

describe("Claude", () => {
  describe("detectClaude", () => {
    test("detects claude in child commands", () => {
      expect(detectClaude(mockPane(["claude", "node"]))).toBe(true);
      expect(
        detectClaude(mockPane(["claude --dangerously-skip-permissions"])),
      ).toBe(true);
    });

    test("does not detect when claude not present", () => {
      expect(detectClaude(mockPane(["node", "npm"]))).toBe(false);
      expect(detectClaude(mockPane([]))).toBe(false);
    });
  });

  describe("detectClaudeStatus", () => {
    test("detects working from spinner status line", () => {
      expect(detectClaudeStatus("", "· Scampering… (1m 0s)")).toBe("working");
      expect(
        detectClaudeStatus("", "✽ Pontificating… (2m 30s · ↓ 2.9k tokens)"),
      ).toBe("working");
      expect(detectClaudeStatus("", "✶ Combobulating… (30s)")).toBe("working");
      expect(detectClaudeStatus("", "✳ Working… (5s)")).toBe("working");
      expect(detectClaudeStatus("", "✻ Thinking… (10s)")).toBe("working");
      expect(detectClaudeStatus("", "* Processing… (1s)")).toBe("working");
    });

    test("detects working from Running indicator", () => {
      expect(detectClaudeStatus("", "⎿  Running…")).toBe("working");
      expect(detectClaudeStatus("", "Running… (2m 5s · timeout 10m)")).toBe(
        "working",
      );
    });

    test("detects idle when no working indicators", () => {
      expect(detectClaudeStatus("", "❯ ")).toBe("idle");
      expect(detectClaudeStatus("", "Some output\n❯ ")).toBe("idle");
      expect(detectClaudeStatus("", "")).toBe("idle");
    });

    test("working indicator takes precedence", () => {
      // Content with both prompt and working indicator
      const content = `
❯ do something
· Scampering… (1m 0s)
───────────
❯
`;
      expect(detectClaudeStatus("", content)).toBe("working");
    });

    test("detects working from braille spinner in title", () => {
      expect(detectClaudeStatus("⠋ Refactor auth", "")).toBe("working");
      expect(detectClaudeStatus("⠂ Improve detection", "")).toBe("working");
    });

    test("detects idle from ✳ glyph in title", () => {
      expect(detectClaudeStatus("✳ Claude Code", "")).toBe("idle");
      expect(detectClaudeStatus("✳ Refactor auth", "")).toBe("idle");
    });

    test("title spinner beats stale prompt in scrollback", () => {
      expect(detectClaudeStatus("⠹ Working", "Do you want to proceed?\n❯ 1. Yes")).toBe(
        "working",
      );
    });

    test("detects blocked from permission prompt", () => {
      const content = "Edit file.ts\nDo you want to proceed?\n❯ 1. Yes\n  2. No";
      expect(detectClaudeStatus("✳ Refactor auth", content)).toBe("blocked");
    });

    test("does not treat conversational prose as blocked", () => {
      const content = "Done. Do you want me to proceed? If yes, just say so.";
      expect(detectClaudeStatus("✳ Refactor auth", content)).toBe("idle");
    });
  });

  describe("parseClaudeSessionTitle", () => {
    test("strips the leading state glyph", () => {
      expect(parseClaudeSessionTitle("⠋ Refactor auth")).toBe("Refactor auth");
      expect(parseClaudeSessionTitle("✳ Refactor auth")).toBe("Refactor auth");
    });

    test("returns null for the default title", () => {
      expect(parseClaudeSessionTitle("✳ Claude Code")).toBe(null);
    });

    test("returns null when empty", () => {
      expect(parseClaudeSessionTitle("")).toBe(null);
    });

    test("returns null for a title without a state glyph", () => {
      expect(parseClaudeSessionTitle("timobook")).toBe(null);
      expect(parseClaudeSessionTitle(":/Users/timo/dev")).toBe(null);
    });
  });

  describe("parseClaudeContext", () => {
    test("returns the used percent from the statusline usage", () => {
      expect(
        parseClaudeContext("Opus 4.8 (xhigh) | 48k/1M (5%) | +0/-0 | dir:main"),
      ).toBe(5);
      expect(parseClaudeContext("… 900k/1M (90%) …")).toBe(90);
    });

    test("returns null when no context usage is present", () => {
      expect(parseClaudeContext("❯ ")).toBe(null);
      expect(parseClaudeContext("")).toBe(null);
    });

    test("ignores parenthized values that are not a token percentage", () => {
      expect(parseClaudeContext("Opus 4.8 (xhigh) working on something")).toBe(
        null,
      );
    });
  });

  describe("parseClaudeStatuslineTitle", () => {
    test("returns the session name from the statusline's trailing field", () => {
      expect(
        parseClaudeStatuslineTitle(
          "Opus 4.8 (xhigh) | 48k/1M (5%) | +0/-0 | agents-dashboard:main | Redesign the TUI",
        ),
      ).toBe("Redesign the TUI");
    });

    test("rejoins a session name that itself contains the separator", () => {
      expect(
        parseClaudeStatuslineTitle(
          "Opus 4.8 | 48k/1M (5%) | +0/-0 | dir:main | fix a | b thing",
        ),
      ).toBe("fix a | b thing");
    });

    test("returns null when the statusline has no session field", () => {
      expect(
        parseClaudeStatuslineTitle(
          "Opus 4.8 (xhigh) | 48k/1M (5%) | +0/-0 | agents-dashboard:main",
        ),
      ).toBe(null);
    });

    test("returns null when no statusline is present", () => {
      expect(parseClaudeStatuslineTitle("some output\n❯ ")).toBe(null);
    });
  });
});

describe("Codex", () => {
  describe("detectCodex", () => {
    test("detects codex in child commands", () => {
      expect(detectCodex(mockPane(["codex", "node"]))).toBe(true);
      expect(detectCodex(mockPane(["node /usr/bin/codex --bypass"]))).toBe(
        true,
      );
    });

    test("does not detect when codex not present", () => {
      expect(detectCodex(mockPane(["node", "npm"]))).toBe(false);
      expect(detectCodex(mockPane([]))).toBe(false);
    });
  });

  describe("detectCodexStatus", () => {
    test("detects working from esc to interrupt", () => {
      expect(detectCodexStatus("", "(2m 56s • esc to interrupt)")).toBe(
        "working",
      );
      expect(
        detectCodexStatus("", "Planning something (1m • esc to interrupt)"),
      ).toBe("working");
      expect(
        detectCodexStatus("", "• Running sleep 600\n(5s • esc to interrupt)"),
      ).toBe("working");
    });

    test("detects idle when no working indicator", () => {
      expect(detectCodexStatus("", "› Run /review")).toBe("idle");
      expect(detectCodexStatus("", "Done — completed task\n› ")).toBe("idle");
      expect(detectCodexStatus("", "99% context left")).toBe("idle");
      expect(detectCodexStatus("", "")).toBe("idle");
    });

    test("detects working from spinner in title", () => {
      expect(detectCodexStatus("⠹ Codex", "")).toBe("working");
    });

    test("detects blocked from Action Required title", () => {
      expect(detectCodexStatus("Action Required — Codex", "")).toBe("blocked");
    });

    test("detects blocked from approval prompt in content", () => {
      expect(detectCodexStatus("", "allow command?\n[y/n]")).toBe("blocked");
    });
  });
});

describe("OpenCode", () => {
  describe("detectOpenCode", () => {
    test("detects opencode in child commands", () => {
      expect(detectOpenCode(mockPane(["opencode"]))).toBe(true);
      expect(detectOpenCode(mockPane(["opencode", "sleep 600"]))).toBe(true);
    });

    test("does not detect when opencode not present", () => {
      expect(detectOpenCode(mockPane(["node", "npm"]))).toBe(false);
      expect(detectOpenCode(mockPane([]))).toBe(false);
    });
  });

  describe("detectOpenCodeStatus", () => {
    test("detects working from esc interrupt", () => {
      expect(detectOpenCodeStatus("esc interrupt ctrl+t variants")).toBe(
        "working",
      );
      expect(detectOpenCodeStatus("■■⬝⬝  esc interrupt  tab agents")).toBe(
        "working",
      );
    });

    test("detects idle when no working indicator", () => {
      expect(detectOpenCodeStatus("↑↓ select  enter submit")).toBe("idle");
      expect(detectOpenCodeStatus("Build  GPT-5.2-Codex")).toBe("idle");
      expect(detectOpenCodeStatus("")).toBe("idle");
    });

    test("detects blocked from permission required", () => {
      expect(detectOpenCodeStatus("△ Permission required\nesc dismiss")).toBe(
        "blocked",
      );
    });
  });
});

describe("Pi", () => {
  describe("detectPi", () => {
    test("detects pi in child commands", () => {
      expect(detectPi(mockPane(["pi"]))).toBe(true);
      expect(detectPi(mockPane(["pi", "sleep 600"]))).toBe(true);
      expect(detectPi(mockPane(["/Users/timo/.npm-global/bin/pi"]))).toBe(true);
      expect(
        detectPi(
          mockPane(["node /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"]),
        ),
      ).toBe(true);
    });

    test("detects pi when pane command is pi", () => {
      const pane = mockPane([]);
      pane.command = "pi";
      expect(detectPi(pane)).toBe(true);
    });

    test("does not false-positive on other commands containing 'pi'", () => {
      expect(detectPi(mockPane(["copilot-language-server"]))).toBe(false);
      expect(detectPi(mockPane(["pip install requests"]))).toBe(false);
      expect(detectPi(mockPane(["gzip archive.tar"]))).toBe(false);
      expect(detectPi(mockPane(["node", "npm"]))).toBe(false);
      expect(detectPi(mockPane([]))).toBe(false);
    });
  });

  describe("detectPiStatus", () => {
    test("detects working from braille spinner in title", () => {
      expect(detectPiStatus("⠋ π - fix auth - agents-dashboard", "")).toBe(
        "working",
      );
      expect(detectPiStatus("⠹ pi - project", "")).toBe("working");
    });

    test("detects working from editor border indicator", () => {
      expect(
        detectPiStatus("π - agents-dashboard", "── ⠹ Working ──────────────────────"),
      ).toBe("working");
      expect(
        detectPiStatus("π - agents-dashboard", "── ⠋ Working... ───────────────────"),
      ).toBe("working");
    });

    test("detects working from interrupt or cancel hints", () => {
      expect(
        detectPiStatus("π - project", "Working (escape to interrupt)"),
      ).toBe("working");
      expect(
        detectPiStatus("π - project", "Working (esc to interrupt)"),
      ).toBe("working");
      expect(
        detectPiStatus(
          "π - project",
          "Retrying (1/3) in 5s... (escape to cancel)",
        ),
      ).toBe("working");
      expect(
        detectPiStatus("π - project", "Compacting context... (escape to cancel)"),
      ).toBe("working");
    });

    test("detects blocked from selector prompts", () => {
      const content =
        "Select an option:\n→ Yes\n  No\n↑↓ navigate  enter select  esc cancel";
      expect(detectPiStatus("π - project", content)).toBe("blocked");
    });

    test("detects blocked from input prompts", () => {
      const content = "Enter a name:\nenter submit  esc cancel";
      expect(detectPiStatus("π - project", content)).toBe("blocked");
    });

    test("detects blocked from confirmation / approval prompts", () => {
      expect(
        detectPiStatus("π - project", "Allow dangerous command?\n[y/n]"),
      ).toBe("blocked");
      expect(
        detectPiStatus("π - project", "Press enter to confirm or esc to cancel"),
      ).toBe("blocked");
    });

    test("detects idle when no working or blocked indicator", () => {
      expect(
        detectPiStatus(
          "π - agents-dashboard",
          "~/Developer/personal/agents-dashboard (main)\n0.0%/1.0M (auto)",
        ),
      ).toBe("idle");
      expect(detectPiStatus("π - agents-dashboard", "")).toBe("idle");
    });
  });

  describe("parsePiSessionTitle", () => {
    test("extracts session name from title", () => {
      expect(
        parsePiSessionTitle("π - fix auth bug - agents-dashboard"),
      ).toBe("fix auth bug");
      expect(
        parsePiSessionTitle("pi - refactor store - project"),
      ).toBe("refactor store");
    });

    test("strips braille spinner before extracting session name", () => {
      expect(
        parsePiSessionTitle("⠋ π - implement feature - repo"),
      ).toBe("implement feature");
    });

    test("handles multi-hyphen session names", () => {
      expect(
        parsePiSessionTitle("π - part 1 - fix issue - repo"),
      ).toBe("part 1 - fix issue");
    });

    test("returns null when title has no session name", () => {
      expect(parsePiSessionTitle("π - agents-dashboard")).toBe(null);
      expect(parsePiSessionTitle("pi - my-repo")).toBe(null);
    });

    test("returns null for non-pi titles", () => {
      expect(parsePiSessionTitle("timobook")).toBe(null);
      expect(parsePiSessionTitle("")).toBe(null);
    });

    test("falls back to footer session name in content", () => {
      const content =
        "some output\n~/Developer/personal/agents-dashboard (main) • my custom session\n↑10k ↓2k 5%/1.0M";
      expect(
        parsePiSessionTitle("π - agents-dashboard", content),
      ).toBe("my custom session");
    });
  });

  describe("parsePiContext", () => {
    test("parses context percent from footer usage", () => {
      expect(
        parsePiContext(
          "↑392k ↓13k R3.4M CH89.2% $0.595 21.4%/1.0M (auto) (google) gemini-3.8-flash",
        ),
      ).toBe(21);
      expect(parsePiContext("0.0%/1.0M (auto)")).toBe(0);
      expect(parsePiContext("85.6%/200k")).toBe(86);
      expect(parsePiContext("100%/128k")).toBe(100);
    });

    test("returns null when no context percentage is present", () => {
      expect(parsePiContext("")).toBe(null);
      expect(parsePiContext("just some output")).toBe(null);
      expect(parsePiContext("?/200k (auto)")).toBe(null);
    });
  });
});
