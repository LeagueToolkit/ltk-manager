import { describe, expect, it } from "vitest";

import { MAP_KEYS } from "../mapKeys";
import { toolEntry, TRANSFORM_TOOLS } from "../mapTools";

describe("TRANSFORM_TOOLS", () => {
  it("maps each transform row to its gizmo tool", () => {
    expect(TRANSFORM_TOOLS).toEqual({ position: "move", rotation: "rotate", scale: "scale" });
  });
});

describe("toolEntry", () => {
  it("returns the rail entry of each transform row's tool, labelled with its key", () => {
    expect(toolEntry(TRANSFORM_TOOLS.position).label()).toContain(MAP_KEYS.move);
    expect(toolEntry(TRANSFORM_TOOLS.rotation).label()).toContain(MAP_KEYS.rotate);
    expect(toolEntry(TRANSFORM_TOOLS.scale).label()).toContain(MAP_KEYS.scale);
  });
});
