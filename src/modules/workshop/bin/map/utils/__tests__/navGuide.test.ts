import { describe, expect, it } from "vitest";

import type { AssetRef, MapNavGridModel, NavRegionGroup } from "@/lib/tauri";

import {
  colorGroupsOf,
  colorModeOf,
  drawnGridOf,
  guideOutlineOf,
  NAV_GUIDE_DEFAULT,
  withOverlay,
} from "../navGuide";

const GRID: AssetRef = { kind: "layer", project: "p", layer: "base", path: "aipath.aimesh_ngrid" };
const SKIN_GRID: AssetRef = { ...GRID, path: "aipath_srx_2.aimesh_ngrid" };

function group(name: string, gameplay: boolean): NavRegionGroup {
  return { name, nameHash: name.length, gameplay, tags: [] };
}

function model(over: Partial<MapNavGridModel> = {}): MapNavGridModel {
  return {
    grid: GRID,
    source: "container",
    skinGrid: null,
    overlays: [
      { label: "NavGrid_Ocean_SEASONAL", flagBit: 3, flags: null, regions: null },
      { label: "NavGrid_AtakhanTop", flagBit: null, flags: null, regions: null },
    ],
    terrainTags: [],
    regionGroups: [group("Music", false), group("GameplayLane", true), group("Vfx", false)],
    errorColor: [0, 0, 255, 255],
    ...over,
  };
}

describe("colorGroupsOf", () => {
  it("lists the gameplay groups first, each part in list order", () => {
    expect(colorGroupsOf(model()).map((each) => each.name)).toEqual([
      "GameplayLane",
      "Music",
      "Vfx",
    ]);
  });
});

describe("colorModeOf", () => {
  it("colors by the group of the persisted name", () => {
    const mode = colorModeOf(model(), "Vfx");

    expect(mode.kind === "region" && mode.group.name).toBe("Vfx");
  });

  it("falls back to terrain if the map has no group of the persisted name", () => {
    expect(colorModeOf(model(), "Ambiance")).toEqual({ kind: "terrain" });
    expect(colorModeOf(model(), null)).toEqual({ kind: "terrain" });
  });
});

describe("drawnGridOf", () => {
  it("draws the skin grid only if it is switched on and the map has one", () => {
    const skinOn = { ...NAV_GUIDE_DEFAULT, skinGrid: true };

    expect(drawnGridOf(model(), skinOn)).toBe(GRID);
    expect(drawnGridOf(model({ skinGrid: SKIN_GRID }), skinOn)).toBe(SKIN_GRID);
    expect(drawnGridOf(model({ skinGrid: SKIN_GRID }), NAV_GUIDE_DEFAULT)).toBe(GRID);
  });
});

describe("guideOutlineOf", () => {
  it("shows a following overlay by the layer mask and a manual one by its switch", () => {
    const guide = withOverlay(NAV_GUIDE_DEFAULT, 1, true);
    const outline = guideOutlineOf(model(), guide, 1 << 3, false);

    expect(outline.navGridShown).toBe(false);
    expect(outline.overlays).toEqual([
      { label: "NavGrid_Ocean_SEASONAL", on: true, following: true },
      { label: "NavGrid_AtakhanTop", on: true, following: false },
    ]);
  });

  it("makes every overlay a manual switch while Follow map state is off", () => {
    const guide = { ...NAV_GUIDE_DEFAULT, followState: false };
    const outline = guideOutlineOf(model(), guide, 1 << 3, true);

    expect(outline.overlays.map(({ on, following }) => [on, following])).toEqual([
      [false, false],
      [false, false],
    ]);
  });
});
