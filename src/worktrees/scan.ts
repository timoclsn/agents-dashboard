import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getGitBranch } from "../tmux/client";

// Root that holds the per-org folders (personal/, taxfix/, …) scanned for worktrees.
const DEVELOPER_DIR = join(homedir(), "Developer");
// Infix the /worktree skill uses to mark a directory as a worktree (e.g. `repo-w-feature`).
const WORKTREE_INFIX = "-w-";
// Disk scan + git-branch lookups are stable between polls, so cache them briefly.
const SCAN_TTL_MS = 5_000;

export interface Worktree {
  path: string;
  name: string;
  org: string;
  gitBranch: string | null;
}

let scanCache: { value: Worktree[]; updatedAt: number } | null = null;

// A linked git worktree has `.git` as a file (pointing at the real gitdir),
// whereas a normal repo has `.git` as a directory.
const isGitWorktree = async (path: string): Promise<boolean> => {
  try {
    return (await stat(join(path, ".git"))).isFile();
  } catch {
    return false;
  }
};

const isOpen = (worktreePath: string, openPaths: Set<string>): boolean => {
  for (const openPath of openPaths) {
    if (openPath === worktreePath || openPath.startsWith(`${worktreePath}/`)) {
      return true;
    }
  }
  return false;
};

const scanWorktreeDirs = async (): Promise<Worktree[]> => {
  const now = Date.now();
  if (scanCache && now - scanCache.updatedAt < SCAN_TTL_MS) {
    return scanCache.value;
  }

  let orgs: string[];
  try {
    const entries = await readdir(DEVELOPER_DIR, { withFileTypes: true });
    orgs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const candidates = (
    await Promise.all(
      orgs.map(async (org) => {
        try {
          const children = await readdir(join(DEVELOPER_DIR, org), {
            withFileTypes: true,
          });
          return children
            .filter((c) => c.isDirectory() && c.name.includes(WORKTREE_INFIX))
            .map((c) => ({
              org,
              name: c.name,
              path: join(DEVELOPER_DIR, org, c.name),
            }));
        } catch {
          return [];
        }
      }),
    )
  ).flat();

  const worktrees = (
    await Promise.all(
      candidates.map(async (candidate) => {
        if (!(await isGitWorktree(candidate.path))) return null;
        return {
          ...candidate,
          gitBranch: await getGitBranch(candidate.path),
        };
      }),
    )
  ).filter((worktree): worktree is Worktree => worktree !== null);

  scanCache = { value: worktrees, updatedAt: Date.now() };
  return worktrees;
};

// Worktrees on disk that don't have a matching tmux pane open, so they can be
// opened quickly from the dashboard.
export const scanWorktrees = async (
  openPaths: Set<string>,
): Promise<Worktree[]> => {
  const all = await scanWorktreeDirs();
  return all
    .filter((worktree) => !isOpen(worktree.path, openPaths))
    .sort((a, b) => a.name.localeCompare(b.name));
};
