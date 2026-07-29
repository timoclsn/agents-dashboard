import type { Checkout, RepoGroup } from "../agents/group";

export const TILE_WIDTH = 38;
export const TILE_GAP = 1;

// A row of the grid: one repo (base + its worktrees), or the trailing "not open"
// row of worktrees whose repo has no live session.
export interface RenderRow {
  key: string;
  kind: "repo" | "disk";
  repo?: RepoGroup;
  checkouts: Checkout[];
}

// Repos stack vertically; each repo's checkouts flow horizontally and wrap onto
// further lines when the terminal is too narrow. Not-open worktrees trail their
// own repo's row; worktrees whose repo has no live session collect in a final
// "not open" row.
export const buildRows = (repos: RepoGroup[]): RenderRow[] => {
  const rows: RenderRow[] = [];

  for (const repo of repos) {
    if (!repo.hasOpenAgents) continue;
    rows.push({ key: repo.key, kind: "repo", repo, checkouts: repo.checkouts });
  }

  const disk = repos
    .filter((r) => !r.hasOpenAgents)
    .flatMap((r) => r.checkouts)
    .sort((a, b) => `${a.org}/${a.dir}`.localeCompare(`${b.org}/${b.dir}`));
  if (disk.length) {
    rows.push({ key: " not-open", kind: "disk", checkouts: disk });
  }

  return rows;
};

// How many tiles fit on one line, and the exact width that holds them — an
// explicit width makes wrapping land where the navigation math expects it.
export const tilesPerLine = (contentWidth: number) =>
  Math.max(1, Math.floor((contentWidth + TILE_GAP) / (TILE_WIDTH + TILE_GAP)));

export const lineWidthFor = (tiles: number) =>
  tiles * (TILE_WIDTH + TILE_GAP) - TILE_GAP;

// The selected checkout: its repo row plus its index within that row's flow.
export interface Selection {
  row: number;
  col: number;
}

interface MoveArgs {
  sel: Selection;
  rows: RenderRow[];
  perLine: number;
}

const lineStart = (index: number, perLine: number) =>
  Math.floor(index / perLine) * perLine;

export const moveRight = ({ sel, rows }: MoveArgs): Selection => {
  const len = rows[sel.row]?.checkouts.length ?? 0;
  return { row: sel.row, col: Math.min(sel.col + 1, Math.max(0, len - 1)) };
};

export const moveLeft = ({ sel }: MoveArgs): Selection => ({
  row: sel.row,
  col: Math.max(sel.col - 1, 0),
});

// Vertical moves treat a repo's wrapped tiles as a grid: step to the line below
// inside the repo first, and only jump to the next repo from the last line.
export const moveDown = ({ sel, rows, perLine }: MoveArgs): Selection => {
  const len = rows[sel.row]?.checkouts.length ?? 0;
  if (sel.col < lineStart(len - 1, perLine)) {
    return { row: sel.row, col: Math.min(sel.col + perLine, len - 1) };
  }
  if (sel.row >= rows.length - 1) return sel;
  const nextLen = rows[sel.row + 1].checkouts.length;
  return { row: sel.row + 1, col: Math.min(sel.col % perLine, nextLen - 1) };
};

export const moveUp = ({ sel, rows, perLine }: MoveArgs): Selection => {
  if (sel.col >= perLine) return { row: sel.row, col: sel.col - perLine };
  if (sel.row === 0) return sel;
  const prevLen = rows[sel.row - 1].checkouts.length;
  return {
    row: sel.row - 1,
    col: Math.min(lineStart(prevLen - 1, perLine) + sel.col, prevLen - 1),
  };
};

// Clamp a selection after the set of rows/checkouts changes under it.
export const clampSelection = ({
  sel,
  rows,
}: {
  sel: Selection;
  rows: RenderRow[];
}): Selection => {
  if (rows.length === 0) return { row: 0, col: 0 };
  const row = Math.min(sel.row, rows.length - 1);
  const col = Math.min(sel.col, Math.max(0, rows[row].checkouts.length - 1));
  return { row, col };
};
