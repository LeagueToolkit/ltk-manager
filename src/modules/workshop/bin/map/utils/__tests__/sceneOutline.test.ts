import { describe, expect, it } from "vitest";

import type { MapChunk, MapGeometryMesh } from "@/lib/tauri";

import { NO_FILTER } from "../mapOutline";
import {
  type GuideOutline,
  groupId,
  guideRowId,
  listedIds,
  rowLevel,
  sceneRows,
} from "../sceneOutline";

const NONE: ReadonlySet<string> = new Set();

function mesh(index: number, controller: string | null, material = "Maps/Grass"): MapGeometryMesh {
  return {
    index,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    min: [0, 0, 0],
    max: [1, 1, 1],
    visibility: 255,
    controller,
    region: null,
    quality: 31,
    backfaceCullingDisabled: false,
    vertexCount: 3,
    materials: [material],
  };
}

const CHUNK: MapChunk = { entry: "0xaaaaaaaa", name: null, items: [] };
const names = (hash: string) => (hash === "0x2" ? "Baron" : "Arena");

describe("listedIds", () => {
  it("lists the meshes and the placeables that the filter keeps, in folded chunks too", () => {
    const chunk: MapChunk = {
      entry: "0xaaaaaaaa",
      name: null,
      items: [
        {
          key: "0x00000001",
          name: "Brazier",
          class: "MapParticle",
          kind: "particle",
          position: [0, 0, 0],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          shape: null,
          visibility: 255,
          controller: null,
        },
      ],
    };

    const all = listedIds({
      meshes: [mesh(0, null), mesh(1, "0x2")],
      chunks: [chunk],
      filter: NO_FILTER,
      controllerName: names,
    });
    const narrowed = listedIds({
      meshes: [mesh(0, null), mesh(1, "0x2")],
      chunks: [chunk],
      filter: { ...NO_FILTER, text: "baron" },
      controllerName: names,
    });

    expect(all).toEqual(["mesh:0", "mesh:1", "0xaaaaaaaa/0x00000001"]);
    expect(narrowed).toEqual(["mesh:1"]);
  });
});

describe("sceneRows", () => {
  it("lists chunks alone when the map has no meshes", () => {
    const rows = sceneRows({
      meshes: [],
      chunks: [CHUNK],
      filter: NO_FILTER,
      opened: NONE,
      shut: NONE,
      controllerName: names,
    });

    expect(rows.map((row) => row.type)).toEqual(["chunk"]);
  });

  it("groups meshes by controller under the meshes section, no controller first", () => {
    const rows = sceneRows({
      meshes: [mesh(0, "0x2"), mesh(1, null), mesh(2, "0x1")],
      chunks: [CHUNK],
      filter: NO_FILTER,
      opened: new Set([groupId("0x2")]),
      shut: NONE,
      controllerName: names,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "section:meshes",
      groupId(null),
      groupId("0x1"),
      groupId("0x2"),
      "mesh:0",
      "section:placeables",
      CHUNK.entry,
    ]);
  });

  it("keeps the meshes whose material holds the search text and opens their group", () => {
    const rows = sceneRows({
      meshes: [mesh(0, null, "Maps/Water"), mesh(1, null)],
      chunks: [CHUNK],
      filter: { text: "water", kinds: new Set() },
      opened: NONE,
      shut: NONE,
      controllerName: names,
    });

    expect(rows.filter((row) => row.type === "mesh").map((row) => row.id)).toEqual(["mesh:0"]);
  });

  it("leaves a shut section's rows out", () => {
    const rows = sceneRows({
      meshes: [mesh(0, null)],
      chunks: [CHUNK],
      filter: NO_FILTER,
      opened: NONE,
      shut: new Set(["section:meshes"]),
      controllerName: names,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "section:meshes",
      "section:placeables",
      CHUNK.entry,
    ]);
  });

  const guides: GuideOutline = {
    navGridShown: true,
    overlays: [
      { label: "NavGrid_Ocean_SEASONAL", on: false, following: true },
      { label: "NavGrid_AtakhanTop", on: true, following: false },
    ],
  };

  it("lists the navgrid and its overlays under a guides section after the placeables", () => {
    const rows = sceneRows({
      meshes: [],
      chunks: [CHUNK],
      filter: NO_FILTER,
      opened: NONE,
      shut: NONE,
      controllerName: names,
      guides,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "section:placeables",
      CHUNK.entry,
      "section:guides",
      guideRowId({ kind: "navGrid" }),
      guideRowId({ kind: "overlay", index: 0 }),
      guideRowId({ kind: "overlay", index: 1 }),
    ]);
    expect(rows.map((row) => rowLevel(row, true))).toEqual([1, 2, 1, 2, 3, 3]);
    expect(
      rows.flatMap((row) => (row.type === "guide" ? [[row.shown, row.following]] : [])),
    ).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it("leaves the guide rows out while the guides section is shut", () => {
    const rows = sceneRows({
      meshes: [],
      chunks: [CHUNK],
      filter: NO_FILTER,
      opened: NONE,
      shut: new Set(["section:guides"]),
      controllerName: names,
      guides,
    });

    expect(rows.at(-1)).toEqual({ type: "section", id: "section:guides", open: false, count: 3 });
  });
});
