import { $ } from "bun";

interface ProcessInfo {
  command: string;
  ppid: number;
}

let processCache: Map<number, ProcessInfo> = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 500; // ms

export const refreshProcessCache = async () => {
  const now = Date.now();
  if (now - lastCacheUpdate < CACHE_TTL) return;

  try {
    const result = await $`ps -A -o pid=,ppid=,command=`.text();
    processCache = new Map();

    for (const line of result.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        const command = parts.slice(2).join(" ");
        if (!isNaN(pid) && !isNaN(ppid)) {
          processCache.set(pid, { command, ppid });
        }
      }
    }
    lastCacheUpdate = now;
  } catch {
    // Ignore errors
  }
};

export const getChildCommands = (pid: number, maxDepth = 3): string[] => {
  const commands: string[] = [];

  const collect = (parentPid: number, depth: number) => {
    if (depth >= maxDepth) return;

    for (const [childPid, info] of processCache) {
      if (info.ppid === parentPid) {
        commands.push(info.command);
        // Also add basename
        const firstWord = info.command.split(/\s+/)[0];
        const basename = firstWord?.split("/").pop();
        if (basename && basename !== info.command) {
          commands.push(basename);
        }
        collect(childPid, depth + 1);
      }
    }
  };

  collect(pid, 0);
  return commands;
};
