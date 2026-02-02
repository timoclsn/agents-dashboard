import { describe, expect, test } from "bun:test";
import { detectClaude, detectClaudeStatus } from "./claude";
import { detectCodex, detectCodexStatus } from "./codex";
import { detectOpenCode, detectOpenCodeStatus } from "./opencode";
import type { PaneInfo } from "../tmux/client";

const mockPane = (childCommands: string[]): PaneInfo => ({
  session: "test",
  window: "1",
  pane: "1",
  title: "test",
  command: "zsh",
  path: "/tmp",
  pid: "1234",
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
      expect(detectCodexStatus("(2m 56s • esc to interrupt)")).toBe("working");
      expect(
        detectCodexStatus("Planning something (1m • esc to interrupt)"),
      ).toBe("working");
      expect(
        detectCodexStatus("• Running sleep 600\n(5s • esc to interrupt)"),
      ).toBe("working");
    });

    test("detects idle when no working indicator", () => {
      expect(detectCodexStatus("› Run /review")).toBe("idle");
      expect(detectCodexStatus("Done — completed task\n› ")).toBe("idle");
      expect(detectCodexStatus("99% context left")).toBe("idle");
      expect(detectCodexStatus("")).toBe("idle");
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
  });
});
