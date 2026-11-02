import { describe, expect, it } from "vitest";

import { insertVertexEdits, moveVertexEdits, removeVertexEdits, VERTICES } from "../regionEdits";

const WALL = { chunk: "0x1", key: "0xaaaaaaaa" };
const HOLDER = "3a79338f{aaaaaaaa}";

describe("region vertex edits", () => {
  it("moves one vertex under the region's Vertices", () => {
    expect(moveVertexEdits(WALL, 2, [1, 2, 3])).toEqual([
      {
        entry: "0x1",
        holder: HOLDER,
        field: VERTICES,
        edits: [{ type: "setLeaf", path: "[2]", value: { type: "vector", values: [1, 2, 3] } }],
      },
    ]);
  });

  it("inserts a vertex before the one at the index and writes it", () => {
    expect(insertVertexEdits(WALL, 1, [4, 5, 6])[0]?.edits).toEqual([
      { type: "insertItem", path: "", item: { index: 1, key: null, class: null } },
      { type: "setLeaf", path: "[1]", value: { type: "vector", values: [4, 5, 6] } },
    ]);
  });

  it("removes the vertex at the index", () => {
    expect(removeVertexEdits(WALL, 0)[0]?.edits).toEqual([{ type: "removeItem", path: "[0]" }]);
  });
});
