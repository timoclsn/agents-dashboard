import { describe, expect, test } from "bun:test";
import type { Checkout } from "../agents/group";
import {
  clampSelection,
  lineWidthFor,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  tilesPerLine,
  TILE_GAP,
  TILE_WIDTH,
  type RenderRow,
} from "./grid";

// Navigation only reads `checkouts.length`, so a row of n placeholder checkouts
// is enough to exercise the grid math.
const row = (key: string, count: number): RenderRow => ({
  key,
  kind: "repo",
  checkouts: Array.from({ length: count }, (_, i) => ({
    key: `${key}-${i}`,
  })) as Checkout[],
});

describe("tilesPerLine", () => {
  test("fits as many tiles as the width allows", () => {
    expect(tilesPerLine(TILE_WIDTH)).toBe(1);
    expect(tilesPerLine(TILE_WIDTH * 2 + TILE_GAP)).toBe(2);
    expect(tilesPerLine(TILE_WIDTH * 2)).toBe(1);
  });

  test("never drops below one tile", () => {
    expect(tilesPerLine(1)).toBe(1);
  });

  test("line width holds exactly that many tiles", () => {
    expect(tilesPerLine(lineWidthFor(3))).toBe(3);
  });
});

describe("horizontal navigation", () => {
  const rows = [row("a", 5)];

  test("flows across wrapped lines and stops at the ends", () => {
    const perLine = 2;
    expect(moveRight({ sel: { row: 0, col: 1 }, rows, perLine }).col).toBe(2);
    expect(moveRight({ sel: { row: 0, col: 4 }, rows, perLine }).col).toBe(4);
    expect(moveLeft({ sel: { row: 0, col: 2 }, rows, perLine }).col).toBe(1);
    expect(moveLeft({ sel: { row: 0, col: 0 }, rows, perLine }).col).toBe(0);
  });

  test("stays on a valid column while there is nothing to select", () => {
    expect(moveRight({ sel: { row: 0, col: 0 }, rows: [], perLine: 2 })).toEqual({
      row: 0,
      col: 0,
    });
  });
});

describe("vertical navigation", () => {
  test("steps down a line inside a wrapped repo before leaving it", () => {
    const rows = [row("a", 5), row("b", 3)];
    expect(moveDown({ sel: { row: 0, col: 0 }, rows, perLine: 2 })).toEqual({
      row: 0,
      col: 2,
    });
    expect(moveDown({ sel: { row: 0, col: 2 }, rows, perLine: 2 })).toEqual({
      row: 0,
      col: 4,
    });
    expect(moveDown({ sel: { row: 0, col: 4 }, rows, perLine: 2 })).toEqual({
      row: 1,
      col: 0,
    });
  });

  test("lands on the last line even when it is partial", () => {
    const rows = [row("a", 5), row("b", 3)];
    // Lines are [0 1 2] and [3 4]; the tile under lane 2 does not exist.
    expect(moveDown({ sel: { row: 0, col: 2 }, rows, perLine: 3 })).toEqual({
      row: 0,
      col: 4,
    });
    expect(moveDown({ sel: { row: 0, col: 3 }, rows, perLine: 3 })).toEqual({
      row: 1,
      col: 0,
    });
  });

  test("keeps the lane when moving to the next repo", () => {
    const rows = [row("a", 3), row("b", 3)];
    expect(moveDown({ sel: { row: 0, col: 1 }, rows, perLine: 3 })).toEqual({
      row: 1,
      col: 1,
    });
  });

  test("clamps the lane to a shorter next repo", () => {
    const rows = [row("a", 3), row("b", 1)];
    expect(moveDown({ sel: { row: 0, col: 2 }, rows, perLine: 3 })).toEqual({
      row: 1,
      col: 0,
    });
  });

  test("stays put at the bottom of the last repo", () => {
    const rows = [row("a", 3)];
    const sel = { row: 0, col: 1 };
    expect(moveDown({ sel, rows, perLine: 3 })).toBe(sel);
  });

  test("steps up a line inside a wrapped repo before leaving it", () => {
    const rows = [row("a", 3), row("b", 5)];
    expect(moveUp({ sel: { row: 1, col: 4 }, rows, perLine: 2 })).toEqual({
      row: 1,
      col: 2,
    });
    expect(moveUp({ sel: { row: 1, col: 2 }, rows, perLine: 2 })).toEqual({
      row: 1,
      col: 0,
    });
  });

  test("enters the previous repo on its last line", () => {
    const rows = [row("a", 5), row("b", 2)];
    expect(moveUp({ sel: { row: 1, col: 0 }, rows, perLine: 2 })).toEqual({
      row: 0,
      col: 4,
    });
    expect(moveUp({ sel: { row: 1, col: 1 }, rows, perLine: 2 })).toEqual({
      row: 0,
      col: 4,
    });
  });

  test("stays put at the top", () => {
    const rows = [row("a", 3)];
    const sel = { row: 0, col: 1 };
    expect(moveUp({ sel, rows, perLine: 3 })).toBe(sel);
  });

  test("down then up returns to the same tile", () => {
    const rows = [row("a", 6), row("b", 4)];
    const perLine = 3;
    const sel = { row: 0, col: 1 };
    expect(moveUp({ sel: moveDown({ sel, rows, perLine }), rows, perLine })).toEqual(
      sel,
    );
  });
});

describe("clampSelection", () => {
  test("pulls the selection back in bounds when rows shrink", () => {
    expect(
      clampSelection({ sel: { row: 3, col: 7 }, rows: [row("a", 2)] }),
    ).toEqual({ row: 0, col: 1 });
  });

  test("resets to the origin when everything disappears", () => {
    expect(clampSelection({ sel: { row: 2, col: 2 }, rows: [] })).toEqual({
      row: 0,
      col: 0,
    });
  });
});
