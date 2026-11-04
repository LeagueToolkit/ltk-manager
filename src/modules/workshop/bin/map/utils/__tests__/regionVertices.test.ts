import { describe, expect, it } from "vitest";

import type { MapChunkItem, MapItemKind, MapItemShape } from "@/lib/tauri";

import type { PlacedItem } from "../mapOutline";
import { leadVertices } from "../regionVertices";

const POINTS: [number, number, number][] = [
  [-1, 0, -1],
  [1, 0, -1],
  [0, 0, 1],
];

const BOUNDARY: MapItemShape = {
  type: "region",
  points: POINTS,
  height: 100,
  lineColor: [255, 0, 0, 255],
  fillColor: [255, 255, 0, 255],
};

function placed(kind: MapItemKind, className: string, shape: MapItemShape | null): PlacedItem {
  const item: MapChunkItem = {
    key: "0xaaaaaaaa",
    name: "Brush",
    class: className,
    kind,
    position: [0, 0, 0],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    shape,
    visibility: 0,
    controller: null,
  };
  return { id: "0x1/0xaaaaaaaa", chunk: { entry: "0x1", name: null, items: [item] }, item };
}

describe("leadVertices", () => {
  it("drags the vertices of a region boundary of an editable map under Select and Move", () => {
    const wall = placed("region", "RegionBoundary", BOUNDARY);

    expect(leadVertices(wall, true, "select")).toEqual({ points: POINTS, access: "drag" });
    expect(leadVertices(wall, true, "move")?.access).toBe("drag");
  });

  it("shows the vertices of a region boundary if the map is read-only", () => {
    const wall = placed("region", "RegionBoundary", BOUNDARY);

    expect(leadVertices(wall, false, "select")).toEqual({ points: POINTS, access: "show" });
  });

  it("shows the vertices of a region boundary under the rotate, scale and place tools", () => {
    const wall = placed("region", "RegionBoundary", BOUNDARY);

    expect(leadVertices(wall, true, "rotate")?.access).toBe("show");
    expect(leadVertices(wall, true, "place")?.access).toBe("show");
  });

  it("shows the vertices of a region guide or a light region on an editable map", () => {
    const polygon: MapItemShape = { type: "polygon", points: POINTS };
    const guide = placed("other", "RegionEntityTemplate", polygon);
    const light = placed("volume", "LightRegionEntityTemplate", polygon);

    expect(leadVertices(guide, true, "select")).toEqual({ points: POINTS, access: "show" });
    expect(leadVertices(light, true, "move")?.access).toBe("show");
  });

  it("returns null if the lead has no polygon", () => {
    const locator = placed("locator", "MapLocator", null);
    const probe = placed("probe", "MapCubemapProbe", {
      type: "box",
      min: [0, 0, 0],
      max: [1, 1, 1],
    });

    expect(leadVertices(null, true, "select")).toBeNull();
    expect(leadVertices(locator, true, "select")).toBeNull();
    expect(leadVertices(probe, true, "select")).toBeNull();
  });
});
