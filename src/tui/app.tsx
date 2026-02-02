import { useState, useEffect } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { pollAgents, type Agent } from "../agents/detect";
import { focusPane, sendKeys } from "../tmux/client";

const POLL_INTERVAL = 500;
const SPINNER_INTERVAL = 80;
const LOADER_INTERVAL = 120;
const MIN_LOADER_DURATION = 1000;
const STAGGER_DELAY = 50;

const SPINNER_FRAMES = ["⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽", "⣾"];
const IDLE_ICON = "•";

const COLORS = {
  bg: "transparent",
  text: "#e2e2e2",
  textSecondary: "#a0a0a0",
  working: "#818cf8",
  idle: "#e2e2e2",
  border: "#606060",
  borderDim: "#484848",
  accent: "#818cf8",
  accentDim: "#6b70b0",
  loaderDim: "#505070",
};

interface AgentGroup {
  title: string;
  sessionId: number;
  displayIndex: number;
  gitBranch: string | null;
  agents: Agent[];
}

const getGroupTitle = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || path;
};

const MAX_BRANCH_LENGTH = 20;

const truncateBranch = (branch: string): string => {
  if (branch.length <= MAX_BRANCH_LENGTH) return branch;
  return branch.slice(0, MAX_BRANCH_LENGTH - 1) + "…";
};

const groupAgents = (agents: Agent[], allAgents: Agent[]): AgentGroup[] => {
  // Build sessionId to displayIndex mapping from all agents (not filtered)
  const sessionIds = [...new Set(allAgents.map((a) => a.sessionId))].sort(
    (a, b) => a - b,
  );
  const sessionIndexMap = new Map(sessionIds.map((id, i) => [id, i]));

  const groups = new Map<
    string,
    { sessionId: number; gitBranch: string | null; agents: Agent[] }
  >();

  for (const agent of agents) {
    const title = getGroupTitle(agent.path);
    const existing = groups.get(title);
    if (existing) {
      existing.agents.push(agent);
    } else {
      groups.set(title, {
        sessionId: agent.sessionId,
        gitBranch: agent.gitBranch,
        agents: [agent],
      });
    }
  }

  return Array.from(groups.entries()).map(
    ([title, { sessionId, gitBranch, agents }]) => ({
      title,
      sessionId,
      displayIndex: sessionIndexMap.get(sessionId) ?? 0,
      gitBranch,
      agents: agents.sort((a, b) => {
        if (a.window !== b.window) return a.window - b.window;
        return a.pane - b.pane;
      }),
    }),
  );
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

const useStaggeredReveal = (totalItems: number, shouldAnimate: boolean) => {
  const [visibleCount, setVisibleCount] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    // Already animated - show all items immediately
    if (hasAnimated) {
      setVisibleCount(totalItems);
      return;
    }

    // Not yet triggered - wait
    if (!shouldAnimate) return;

    // Run the staggered animation
    if (totalItems === 0) {
      setHasAnimated(true);
      return;
    }

    let count = 0;
    const interval = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= totalItems) {
        clearInterval(interval);
        setHasAnimated(true);
      }
    }, STAGGER_DELAY);

    return () => clearInterval(interval);
  }, [shouldAnimate, totalItems, hasAnimated]);

  return visibleCount;
};

interface AgentRowProps {
  agent: Agent;
  selected: boolean;
  isLast: boolean;
  onClick: () => void;
}

const MAX_SESSION_TITLE_LENGTH = 40;

const truncateSessionTitle = (title: string): string => {
  if (title.length <= MAX_SESSION_TITLE_LENGTH) return title;
  return title.slice(0, MAX_SESSION_TITLE_LENGTH - 1) + "…";
};

const AgentRow = ({ agent, selected, isLast, onClick }: AgentRowProps) => {
  const paneRef = `${agent.window}.${agent.pane}`;
  const isWorking = agent.status === "working";
  const icon = useSpinner(isWorking);

  const treeChar = isLast ? "└" : "├";

  // Left-border indicator for selection
  const selectionIndicator = selected ? "▌" : " ";

  const title = agent.sessionTitle
    ? truncateSessionTitle(agent.sessionTitle)
    : "untitled";

  return (
    <box
      onMouseUp={onClick}
      style={{
        height: 1,
        flexDirection: "row",
      }}
    >
      <text style={{ fg: selected ? COLORS.accent : "transparent" }}>
        {selectionIndicator}
      </text>
      <text style={{ fg: COLORS.borderDim }}>{treeChar}─</text>
      <text
        style={{
          fg: isWorking ? COLORS.working : COLORS.text,
          width: 2,
        }}
      >
        {icon}
      </text>
      <text style={{ fg: COLORS.text }}>{title}</text>
      <text style={{ fg: COLORS.border }}> · </text>
      <text style={{ fg: COLORS.textSecondary }}>{agent.type}</text>
      <text style={{ fg: COLORS.borderDim }}>{`  ${paneRef}`}</text>
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
        <text style={{ fg: COLORS.border }}>{group.displayIndex} </text>
        {hasAttached && <text style={{ fg: COLORS.accent }}>● </text>}
        {group.title.includes("/") ? (
          <>
            <text style={{ fg: COLORS.textSecondary }}>
              {group.title.split("/")[0]}/
            </text>
            <text style={{ fg: COLORS.text }}>
              {group.title.split("/").slice(1).join("/")}
            </text>
          </>
        ) : (
          <text style={{ fg: COLORS.text }}>{group.title}</text>
        )}
        {group.gitBranch && (
          <text style={{ fg: COLORS.border }}>
            :{truncateBranch(group.gitBranch)}
          </text>
        )}
        {workingCount > 0 && (
          <text style={{ fg: COLORS.accentDim }}> {workingCount} working</text>
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

interface HeaderProps {
  count: number;
  workingCount: number;
  isLoading: boolean;
}

const Header = ({ count, workingCount, isLoading }: HeaderProps) => (
  <box style={{ marginBottom: 1, flexDirection: "row", height: 1 }}>
    <text style={{ fg: COLORS.accent }}>◈ </text>
    <text style={{ fg: COLORS.text }}>agents</text>
    {!isLoading && (
      <>
        <text style={{ fg: COLORS.border }}> {count}</text>
        {workingCount > 0 && (
          <>
            <text style={{ fg: COLORS.borderDim }}> · </text>
            <text style={{ fg: COLORS.accentDim }}>{workingCount} working</text>
          </>
        )}
      </>
    )}
  </box>
);

const Footer = () => (
  <box style={{ marginTop: 1, flexDirection: "row" }}>
    <text style={{ fg: COLORS.border }}>↑↓</text>
    <text style={{ fg: COLORS.textSecondary }}> nav</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.border }}>⏎</text>
    <text style={{ fg: COLORS.textSecondary }}> focus</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.border }}>^x</text>
    <text style={{ fg: COLORS.textSecondary }}> kill</text>
    <text style={{ fg: COLORS.borderDim }}> · </text>
    <text style={{ fg: COLORS.border }}>esc</text>
    <text style={{ fg: COLORS.textSecondary }}> quit</text>
  </box>
);

const EmptyState = () => (
  <box style={{ flexDirection: "column", marginTop: 1 }}>
    <text style={{ fg: COLORS.textSecondary }}>No agents running</text>
    <box style={{ flexDirection: "row", height: 1, marginTop: 1 }}>
      <text style={{ fg: COLORS.borderDim }}>└ </text>
      <text style={{ fg: COLORS.border }}>
        start claude, codex, or opencode in tmux
      </text>
    </box>
  </box>
);

const RADAR_FRAMES = ["◜", "◝", "◞", "◟"];

const LoadingState = () => {
  const [scanFrame, setScanFrame] = useState(0);
  const [radarFrame, setRadarFrame] = useState(0);

  // Full width minus padding (1 on each side)
  const scanWidth = Math.max(20, (process.stdout.columns || 80) - 2);
  const totalFrames = scanWidth + 2;

  useEffect(() => {
    const scanInterval = setInterval(() => {
      setScanFrame((f) => (f + 1) % totalFrames);
    }, LOADER_INTERVAL);

    const radarInterval = setInterval(() => {
      setRadarFrame((f) => (f + 1) % RADAR_FRAMES.length);
    }, 100);

    return () => {
      clearInterval(scanInterval);
      clearInterval(radarInterval);
    };
  }, [totalFrames]);

  const highlightPos = scanFrame - 1;
  const scanLine = Array.from({ length: scanWidth }, (_, j) => {
    if (j === highlightPos || j === highlightPos + 1) return "▰";
    return "▱";
  }).join("");

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <text style={{ fg: COLORS.accent }}>{RADAR_FRAMES[radarFrame]} </text>
        <text style={{ fg: COLORS.text }}>Summoning the agents</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, marginTop: 1 }}>
        <text style={{ fg: COLORS.borderDim }}>
          {scanLine.slice(0, Math.max(0, highlightPos))}
        </text>
        <text style={{ fg: COLORS.accent }}>
          {scanLine.slice(
            Math.max(0, highlightPos),
            Math.min(scanWidth, highlightPos + 2),
          )}
        </text>
        <text style={{ fg: COLORS.borderDim }}>
          {scanLine.slice(Math.min(scanWidth, highlightPos + 2))}
        </text>
      </box>
      <box style={{ flexDirection: "row", height: 1, marginTop: 1 }}>
        <text style={{ fg: COLORS.borderDim }}>└ </text>
        <text style={{ fg: COLORS.textSecondary }}>scanning tmux sessions</text>
      </box>
    </box>
  );
};

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
      <text style={{ fg: hasValue ? COLORS.accent : COLORS.borderDim }}>
        {hasValue ? "› " : "  "}
      </text>
      <text style={{ fg: hasValue ? COLORS.text : COLORS.border }}>
        {hasValue ? value : "type to filter"}
      </text>
      {hasValue && <text style={{ fg: COLORS.accent }}>{cursor}</text>}
    </box>
  );
};

interface AppProps {
  forceLoading?: boolean;
}

export const App = ({ forceLoading = false }: AppProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);
  const renderer = useRenderer();

  const isLoading = !dataLoaded || !minTimeElapsed;

  const allGroups = groupAgents(agents, agents);
  const groups = searchQuery
    ? allGroups.filter((g) =>
        g.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allGroups;
  const flatAgents = groups.flatMap((g) => g.agents);
  const workingCount = agents.filter((a) => a.status === "working").length;

  const visibleGroupCount = useStaggeredReveal(groups.length, justLoaded);

  useEffect(() => {
    const timer = setTimeout(
      () => setMinTimeElapsed(true),
      MIN_LOADER_DURATION,
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading && !justLoaded && agents.length > 0) {
      setJustLoaded(true);
    }
  }, [isLoading, justLoaded, agents.length]);

  useEffect(() => {
    let cancelled = false;
    let pollId = 0;
    let initialSelectionSet = false;

    // Allow overlapping polls, but only apply the latest result.
    const poll = async () => {
      const id = ++pollId;
      try {
        const result = await pollAgents();
        if (!cancelled && id === pollId) {
          setAgents(result);
          setDataLoaded(true);

          // Set initial cursor to attached session on first load
          if (!initialSelectionSet && result.length > 0) {
            initialSelectionSet = true;
            const groups = groupAgents(result, result);
            const flat = groups.flatMap((g) => g.agents);
            const attachedIndex = flat.findIndex((a) => a.attached);
            if (attachedIndex !== -1) {
              setSelectedIndex(attachedIndex);
            }
          }
        }
      } catch {}
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
    if (key.ctrl && key.name === "x") {
      const agent = flatAgents[selectedIndex];
      if (agent) {
        sendKeys(agent.target, "C-c");
        sendKeys(agent.target, "C-c");
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
      <Header
        count={agents.length}
        workingCount={workingCount}
        isLoading={isLoading || forceLoading}
      />
      <SearchField value={searchQuery} />

      {isLoading || forceLoading ? (
        <LoadingState />
      ) : agents.length === 0 ? (
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
            {groups.slice(0, visibleGroupCount).map((group, i) => (
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
