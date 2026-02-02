import { pollAgents, type Agent } from "../agents/detect";
import { debugListPanes } from "../tmux/client";

const TYPE_ICONS: Record<Agent["type"], string> = {
  claude: "◆",
  codex: "◇",
  opencode: "○",
  unknown: "?",
};

const STATUS_ICONS: Record<Agent["status"], string> = {
  idle: "⏸",
  working: "▶",
};

const formatAgent = (agent: Agent): string => {
  const attachedIcon = agent.attached ? "▸" : " ";
  const typeIcon = TYPE_ICONS[agent.type];
  const statusIcon = STATUS_ICONS[agent.status];
  const project = agent.path.split("/").pop() || agent.path;

  return `${attachedIcon} ${statusIcon} ${typeIcon} ${agent.type.padEnd(8)} ${agent.target.padEnd(20)} ${project}`;
};

const printAgents = (agents: Agent[]) => {
  console.clear();
  console.log("Agents Dashboard (CLI mode)\n");

  if (agents.length === 0) {
    console.log("No agents detected...\n");
    return;
  }

  console.log(
    `  ${"ST".padEnd(2)} ${"T".padEnd(1)} ${"TYPE".padEnd(8)} ${"TARGET".padEnd(20)} PROJECT`,
  );
  console.log("-".repeat(62));

  for (const agent of agents) {
    console.log(formatAgent(agent));
  }

  console.log(`\nTotal: ${agents.length} agent(s)`);
};

interface CliOptions {
  watch?: boolean;
  debug?: boolean;
}

export const runCli = async ({ watch = false, debug = false }: CliOptions) => {
  if (debug) {
    console.log("=== DEBUG: Raw pane data ===\n");
    await debugListPanes();
    console.log("\n=== Detected agents ===\n");
  }

  const agents = await pollAgents();
  printAgents(agents);

  if (watch) {
    console.log("\nWatching for changes (Ctrl+C to exit)...\n");

    let pollId = 0;
    // Allow overlapping polls, but only apply the latest result.
    const interval = setInterval(() => {
      const id = ++pollId;
      pollAgents()
        .then((updated) => {
          if (id === pollId) {
            printAgents(updated);
          }
        })
        .catch(() => {});
    }, 1000);
    void interval;
  }
};
