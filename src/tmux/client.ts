import { $ } from "bun";
import { refreshProcessCache, getChildCommands } from "./process";

const SEP = "|||";

export interface PaneInfo {
  session: string;
  window: number;
  pane: number;
  title: string;
  command: string;
  path: string;
  pid: number;
  childCommands: string[];
  attached: boolean;
}

export const listPanes = async (): Promise<PaneInfo[]> => {
  try {
    await refreshProcessCache();

    const format = `#{session_attached}${SEP}#{session_name}${SEP}#{window_index}${SEP}#{pane_index}${SEP}#{pane_title}${SEP}#{pane_current_command}${SEP}#{pane_current_path}${SEP}#{pane_pid}`;
    const result = await $`tmux list-panes -a -F ${format}`.text();

    return result
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(SEP);
        const [attached, session, window, pane, title, command, path, pidStr] =
          parts;
        const pid = parseInt(pidStr, 10) || 0;
        return {
          session,
          window: parseInt(window, 10),
          pane: parseInt(pane, 10),
          title,
          command,
          path,
          pid,
          childCommands: getChildCommands(pid),
          attached: attached === "1",
        };
      });
  } catch {
    return [];
  }
};

export const capturePane = async (target: string): Promise<string> => {
  try {
    return await $`tmux capture-pane -p -t ${target} -S -50`.text();
  } catch {
    return "";
  }
};

export const focusPane = async (target: string): Promise<void> => {
  try {
    await $`tmux display-popup -C`.quiet();
  } catch {
    // Ignore if no popup is open
  }
  try {
    await $`tmux switch-client -t ${target}`.quiet();
  } catch {
    // Ignore errors
  }
};

export const debugListPanes = async (): Promise<void> => {
  await refreshProcessCache();

  const format = `#{session_attached}${SEP}#{session_name}${SEP}#{window_index}${SEP}#{pane_index}${SEP}#{pane_title}${SEP}#{pane_current_command}${SEP}#{pane_current_path}${SEP}#{pane_pid}`;
  const result = await $`tmux list-panes -a -F ${format}`.text();

  const lines = result.trim().split("\n");

  for (const line of lines) {
    const parts = line.split(SEP);
    if (parts.length < 8) continue;

    const [attached, session, window, pane, title, command, , pidStr] = parts;
    const isAttached = attached === "1";
    const pid = parseInt(pidStr, 10) || 0;
    const childCommands = getChildCommands(pid);

    const marker = isAttached ? "✓" : "○";
    const children =
      childCommands.length > 0
        ? `children=[${childCommands.slice(0, 3).join(", ")}${childCommands.length > 3 ? "..." : ""}]`
        : "";
    console.log(
      `${marker} ${session}:${window}.${pane}  cmd="${command}"  title="${title}"  ${children}`,
    );
  }
};
