import { useState, useEffect } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { pollAgents, type Agent } from "../agents/detect";
import { focusPane } from "../tmux/client";

const POLL_INTERVAL = 500;

const STATUS_STYLES = {
  idle: { icon: "●", color: "#888888" },
  working: { icon: "◉", color: "#00ff00" },
};

const TYPE_COLORS = {
  claude: "#cc785c",
  codex: "#00d4aa",
  opencode: "#7c93ee",
  unknown: "#888888",
};

const AgentRow = ({ agent, selected }: { agent: Agent; selected: boolean }) => {
  const projectName = agent.path.split("/").pop() || agent.path;
  const statusStyle = STATUS_STYLES[agent.status];

  return (
    <box
      style={{
        height: 1,
        width: "100%",
        backgroundColor: selected ? "#333366" : "transparent",
        flexDirection: "row",
        gap: 1,
      }}
    >
      <text style={{ fg: agent.attached ? "#ffffff" : "#444444", width: 1 }}>
        {agent.attached ? "▸" : " "}
      </text>
      <text style={{ fg: statusStyle.color, width: 2 }}>
        {statusStyle.icon}
      </text>
      <text style={{ fg: TYPE_COLORS[agent.type], width: 8 }}>
        {agent.type}
      </text>
      <text style={{ width: 20 }}>{agent.target}</text>
      <text style={{ fg: "#666666" }}>{projectName}</text>
    </box>
  );
};

const Header = ({ count }: { count: number }) => (
  <box style={{ marginBottom: 1, flexDirection: "row", gap: 1 }}>
    <text style={{ fg: "#ffffff" }}>Agents Dashboard</text>
    <text style={{ fg: "#666666" }}>({count} running)</text>
  </box>
);

const Footer = () => (
  <box style={{ marginTop: 1 }}>
    <text style={{ fg: "#666666" }}>
      j/k: navigate | enter: focus | q: quit
    </text>
  </box>
);

const EmptyState = () => (
  <box style={{ padding: 1 }}>
    <text style={{ fg: "#666666" }}>No agents detected...</text>
  </box>
);

export const App = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const renderer = useRenderer();

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
    switch (key.name) {
      case "j":
      case "down":
        setSelectedIndex((i) => Math.min(i + 1, agents.length - 1));
        break;
      case "k":
      case "up":
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "return": {
        const agent = agents[selectedIndex];
        if (agent) {
          focusPane(agent.target);
        }
        break;
      }
      case "q":
      case "escape":
        renderer.destroy();
        process.exit(0);
    }
  });

  // Keep selection in bounds
  useEffect(() => {
    if (selectedIndex >= agents.length && agents.length > 0) {
      setSelectedIndex(agents.length - 1);
    }
  }, [agents.length, selectedIndex]);

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <Header count={agents.length} />

      {agents.length === 0 ? (
        <EmptyState />
      ) : (
        <box style={{ flexDirection: "column" }}>
          {agents.map((agent, i) => (
            <AgentRow
              key={agent.target}
              agent={agent}
              selected={i === selectedIndex}
            />
          ))}
        </box>
      )}

      <Footer />
    </box>
  );
};
