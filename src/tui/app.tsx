import { useState, useEffect } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { pollAgents, type Agent } from "../agents/detect";
import { focusPane } from "../tmux/client";

const POLL_INTERVAL = 500;
const SPINNER_INTERVAL = 80;

const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
const IDLE_ICON = "•";

const COLORS = {
  bg: "transparent",
  bgSelected: "#2a2a4a",
  text: "#e2e2e2",
  textSecondary: "#a0a0a0",
  working: "#818cf8",
  idle: "#e2e2e2",
  border: "#505050",
  accent: "#818cf8",
};

interface AgentGroup {
  title: string;
  sessionId: number;
  displayIndex: number;
  agents: Agent[];
}

const getGroupTitle = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || path;
};

const groupAgents = (agents: Agent[], allAgents: Agent[]): AgentGroup[] => {
  // Build sessionId to displayIndex mapping from all agents (not filtered)
  const sessionIds = [...new Set(allAgents.map((a) => a.sessionId))].sort(
    (a, b) => a - b,
  );
  const sessionIndexMap = new Map(sessionIds.map((id, i) => [id, i]));

  const groups = new Map<string, { sessionId: number; agents: Agent[] }>();

  for (const agent of agents) {
    const title = getGroupTitle(agent.path);
    const existing = groups.get(title);
    if (existing) {
      existing.agents.push(agent);
    } else {
      groups.set(title, { sessionId: agent.sessionId, agents: [agent] });
    }
  }

  return Array.from(groups.entries()).map(([title, { sessionId, agents }]) => ({
    title,
    sessionId,
    displayIndex: sessionIndexMap.get(sessionId) ?? 0,
    agents: agents.sort((a, b) => {
      if (a.window !== b.window) return a.window - b.window;
      return a.pane - b.pane;
    }),
  }));
};

const useSpinner = (active: boolean) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(interval);
  }, [active]);

  return active ? SPINNER_FRAMES[frame] : IDLE_ICON;
};

interface AgentRowProps {
  agent: Agent;
  selected: boolean;
  isLast: boolean;
  onClick: () => void;
}

const AGENT_TYPE_WIDTH = 8; // "opencode" is the longest

const AgentRow = ({ agent, selected, isLast, onClick }: AgentRowProps) => {
  const paneRef = `${agent.window}.${agent.pane}`;
  const isWorking = agent.status === "working";
  const icon = useSpinner(isWorking);

  const treeChar = isLast ? "└" : "├";
  const paddedType = agent.type.padEnd(AGENT_TYPE_WIDTH);

  return (
    <box
      onMouseUp={onClick}
      style={{
        height: 1,
        flexDirection: "row",
      }}
    >
      <text style={{ fg: COLORS.border }}>{treeChar}─ </text>
      <text style={{ fg: isWorking ? COLORS.working : COLORS.idle, width: 2 }}>
        {icon}
      </text>
      <text> </text>
      <text style={{ fg: COLORS.text }}>{paddedType}</text>
      <text style={{ fg: COLORS.textSecondary }}> {paneRef}</text>
      {selected && <text style={{ fg: COLORS.accent }}> ◀</text>}
    </box>
  );
};

interface SessionGroupProps {
  group: AgentGroup;
  selectedAgent: Agent | null;
  isFirst: boolean;
  onAgentClick: (agent: Agent) => void;
}

const SessionGroup = ({
  group,
  selectedAgent,
  isFirst,
  onAgentClick,
}: SessionGroupProps) => {
  const hasAttached = group.agents.some((a) => a.attached);
  const workingCount = group.agents.filter(
    (a) => a.status === "working",
  ).length;

  return (
    <box style={{ flexDirection: "column", marginTop: isFirst ? 0 : 1 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <text style={{ fg: COLORS.textSecondary }}>
          ({group.displayIndex}){" "}
        </text>
        <text style={{ fg: COLORS.text }}>{group.title}</text>
        {hasAttached && <text style={{ fg: COLORS.accent }}> ●</text>}
        {workingCount > 0 && (
          <text style={{ fg: COLORS.textSecondary }}>
            {" "}
            ({workingCount} active)
          </text>
        )}
      </box>
      <box style={{ flexDirection: "column" }}>
        {group.agents.map((agent, i) => (
          <AgentRow
            key={agent.target}
            agent={agent}
            selected={selectedAgent?.target === agent.target}
            isLast={i === group.agents.length - 1}
            onClick={() => onAgentClick(agent)}
          />
        ))}
      </box>
    </box>
  );
};

const Header = ({
  count,
  workingCount,
}: {
  count: number;
  workingCount: number;
}) => (
  <box style={{ marginBottom: 1, flexDirection: "row", height: 1 }}>
    <text style={{ fg: COLORS.accent }}>◈</text>
    <text style={{ fg: COLORS.text }}> agents </text>
    <text style={{ fg: COLORS.textSecondary }}>
      {count} running
      {workingCount > 0 && ` · ${workingCount} active`}
    </text>
  </box>
);

const Footer = () => (
  <box style={{ marginTop: 1, flexDirection: "row" }}>
    <text style={{ fg: COLORS.textSecondary }}>type to filter </text>
    <text style={{ fg: COLORS.text }}>↑↓</text>
    <text style={{ fg: COLORS.textSecondary }}> nav </text>
    <text style={{ fg: COLORS.text }}>⏎</text>
    <text style={{ fg: COLORS.textSecondary }}> focus </text>
    <text style={{ fg: COLORS.text }}>esc</text>
    <text style={{ fg: COLORS.textSecondary }}> clear/quit</text>
  </box>
);

const EmptyState = () => (
  <box style={{ flexDirection: "column", marginTop: 1 }}>
    <text style={{ fg: COLORS.textSecondary }}>No agents running</text>
    <text style={{ fg: COLORS.textSecondary }}>
      Start a Claude, Codex, or OpenCode session in tmux
    </text>
  </box>
);

const CURSOR_FRAMES = ["▏", "▎", "▍", "▌", "▍", "▎"];
const CURSOR_INTERVAL = 200;

const useCursor = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % CURSOR_FRAMES.length);
    }, CURSOR_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return CURSOR_FRAMES[frame];
};

interface SearchFieldProps {
  value: string;
}

const SearchField = ({ value }: SearchFieldProps) => {
  const cursor = useCursor();
  const hasValue = value.length > 0;

  return (
    <box style={{ flexDirection: "row", height: 1, marginBottom: 1 }}>
      <text style={{ fg: hasValue ? COLORS.accent : COLORS.border }}>❯ </text>
      {!hasValue && <text style={{ fg: COLORS.textSecondary }}>{cursor}</text>}
      <text style={{ fg: hasValue ? COLORS.text : COLORS.border }}>
        {hasValue ? value : "filter"}
      </text>
      {hasValue && <text style={{ fg: COLORS.accent }}>{cursor}</text>}
    </box>
  );
};

export const App = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const renderer = useRenderer();

  const allGroups = groupAgents(agents, agents);
  const groups = searchQuery
    ? allGroups.filter((g) =>
        g.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allGroups;
  const flatAgents = groups.flatMap((g) => g.agents);
  const workingCount = agents.filter((a) => a.status === "working").length;

  useEffect(() => {
    let cancelled = false;
    let pollId = 0;

    // Allow overlapping polls, but only apply the latest result.
    const poll = async () => {
      const id = ++pollId;
      try {
        const result = await pollAgents();
        if (!cancelled && id === pollId) {
          setAgents(result);
        }
      } catch {
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useKeyboard((key) => {
    // Jump to tmux session by display index: 0-9 when search is empty
    if (!searchQuery && key.name && /^[0-9]$/.test(key.name)) {
      const targetDisplayIndex = parseInt(key.name, 10);
      const targetGroup = allGroups.find(
        (g) => g.displayIndex === targetDisplayIndex,
      );
      if (targetGroup && targetGroup.agents.length > 0) {
        const firstAgent = targetGroup.agents[0];
        focusPane(firstAgent.target);
      }
      return;
    }

    // Navigation: arrow keys or ctrl+n/p
    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setSelectedIndex((i) => Math.min(i + 1, flatAgents.length - 1));
      return;
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }

    // Actions
    if (key.name === "return") {
      const agent = flatAgents[selectedIndex];
      if (agent) focusPane(agent.target);
      return;
    }
    if (key.name === "escape") {
      if (searchQuery) {
        setSearchQuery("");
      } else {
        renderer.destroy();
        process.exit(0);
      }
      return;
    }

    // Search input
    if (key.name === "backspace") {
      setSearchQuery((q) => q.slice(0, -1));
      return;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setSearchQuery((q) => q + key.sequence);
    }
  });

  useEffect(() => {
    if (flatAgents.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= flatAgents.length) {
      setSelectedIndex(flatAgents.length - 1);
    }
  }, [flatAgents.length, selectedIndex]);

  const selectedAgent = flatAgents[selectedIndex] || null;

  const handleAgentClick = (agent: Agent) => {
    const index = flatAgents.findIndex((a) => a.target === agent.target);
    if (index !== -1) {
      setSelectedIndex(index);
    }
    focusPane(agent.target);
  };

  return (
    <box style={{ flexDirection: "column", padding: 1, height: "100%" }}>
      <Header count={agents.length} workingCount={workingCount} />
      <SearchField value={searchQuery} />

      {agents.length === 0 ? (
        <EmptyState />
      ) : groups.length === 0 ? (
        <box style={{ marginTop: 1 }}>
          <text style={{ fg: COLORS.textSecondary }}>No matches</text>
        </box>
      ) : (
        <scrollbox
          focused
          style={{
            flexGrow: 1,
            scrollbarOptions: {
              showArrows: false,
              trackOptions: {
                foregroundColor: COLORS.accent,
                backgroundColor: COLORS.border,
              },
            },
          }}
        >
          <box style={{ flexDirection: "column" }}>
            {groups.map((group, i) => (
              <SessionGroup
                key={group.title}
                group={group}
                selectedAgent={selectedAgent}
                isFirst={i === 0}
                onAgentClick={handleAgentClick}
              />
            ))}
          </box>
        </scrollbox>
      )}

      <Footer />
    </box>
  );
};
