import { describe, expect, it } from "vitest";

import type { MeshGeometry, MeshRange } from "@/modules/viewport";

import { nameHash } from "../../binHash";
import { drawnIndices, rangesDrawn } from "../submeshes";

function mesh(indices: number[], ranges: MeshRange[]): MeshGeometry {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: null,
    uvs: null,
    skinIndices: null,
    skinWeights: null,
    indices: Uint32Array.from(indices),
    ranges,
  };
}

describe("drawnIndices", () => {
  const THREE_RUNS = mesh(
    [0, 1, 2, 0, 2, 1, 1, 2, 0],
    [
      { name: "body", startIndex: 0, indexCount: 3 },
      { name: "glow", startIndex: 3, indexCount: 3 },
      { name: "cape", startIndex: 6, indexCount: 3 },
    ],
  );

  it("leaves the whole mesh for a draw list naming nothing, or nothing the mesh holds", () => {
    expect(drawnIndices(THREE_RUNS, [], [])).toBe(THREE_RUNS.indices);
    expect(drawnIndices(THREE_RUNS, [nameHash("horns")], [])).toBe(THREE_RUNS.indices);
    expect(drawnIndices(THREE_RUNS, [], [nameHash("cape")])).toBe(THREE_RUNS.indices);
  });

  it("keeps the submeshes the draw list names, in the file's order", () => {
    const kept = drawnIndices(THREE_RUNS, [nameHash("cape"), nameHash("body")], []);

    expect([...kept]).toEqual([0, 1, 2, 1, 2, 0]);
  });

  it("adds the always list on top of what the draw list leaves", () => {
    const kept = drawnIndices(THREE_RUNS, [nameHash("glow")], [nameHash("cape")]);

    expect([...kept]).toEqual([0, 2, 1, 1, 2, 0]);
  });

  it("drops a submesh whose run the index block does not hold", () => {
    const past = mesh(
      [0, 1, 2],
      [
        { name: "body", startIndex: 0, indexCount: 3 },
        { name: "gone", startIndex: 3, indexCount: 3 },
      ],
    );

    const kept = drawnIndices(past, [nameHash("body"), nameHash("gone")], []);

    expect([...kept]).toEqual([0, 1, 2]);
  });
});

describe("rangesDrawn", () => {
  const DRAWN: MeshRange[] = [
    { name: "Body", startIndex: 0, indexCount: 3 },
    { name: "Glow", startIndex: 3, indexCount: 3 },
    { name: "Cape", startIndex: 6, indexCount: 3 },
  ];

  it("draws over every submesh the character draws where the list names none of them", () => {
    expect(rangesDrawn(DRAWN, [], [], [])).toEqual([true, true, true]);
    expect(rangesDrawn(DRAWN, ["cape"], [nameHash("horns")], [])).toEqual([true, true, false]);
  });

  it("narrows to the named submeshes and adds the always list on top", () => {
    expect(rangesDrawn(DRAWN, [], [nameHash("glow")], [nameHash("cape")])).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("draws an always submesh the character is drawn without", () => {
    expect(rangesDrawn(DRAWN, ["CAPE", "glow"], [], [nameHash("cape")])).toEqual([
      true,
      false,
      true,
    ]);
  });
});
