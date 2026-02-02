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
  agents: Agent[];
}

const getGroupTitle = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || path;
};

const groupAgents = (agents: Agent[]): AgentGroup[] => {
  const groups = new Map<string, Agent[]>();

  for (const agent of agents) {
    const title = getGroupTitle(agent.path);
    const existing = groups.get(title) || [];
    existing.push(agent);
    groups.set(title, existing);
  }

  return Array.from(groups.entries())
    .map(([title, agents]) => ({
      title,
      agents: agents.sort((a, b) => {
        if (a.window !== b.window) return a.window - b.window;
        return a.pane - b.pane;
      }),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
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

const AgentRow = ({ agent, selected, isLast, onClick }: AgentRowProps) => {
  const paneRef = `${agent.window}.${agent.pane}`;
  const isWorking = agent.status === "working";
  const icon = useSpinner(isWorking);

  const treeChar = isLast ? "└" : "├";

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
      <text style={{ fg: COLORS.text }}>{agent.type}</text>
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

  const allGroups = groupAgents(agents);
  const groups = searchQuery
    ? allGroups.filter((g) =>
        g.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allGroups;
  const flatAgents = groups.flatMap((g) => g.agents);
  const workingCount = agents.filter((a) => a.status === "working").length;

  useEffect(() => {
    const poll = async () => {
      const result = await pollAgents();
      setAgents(result);
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  useKeyboard((key) => {
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
