/**
 * The navgrid overlay switches of a map document and the color choices of the Guides menu, per
 * "Overlays follow the visibility layers" and "The shell" in docs/plans/navgrid-guides.md.
 */

import type { AssetRef, MapNavGridModel, NavRegionGroup } from "@/lib/tauri";
import type { NavGridColorMode } from "@/modules/viewport";

import type { GuideOutline } from "./sceneOutline";

/** The overlay switches of the Guides menu for one map document. */
export interface NavGuide {
  /** An overlay that matches a visibility flag is on while the shown layer mask has the flag. */
  readonly followState: boolean;
  /** The switch of each overlay that the reader set, by index in the model's overlay list. */
  readonly overlays: ReadonlyMap<number, boolean>;
  /** The guide draws the skin's grid in place of the container's. */
  readonly skinGrid: boolean;
}

/** The switches of a document that the reader has not changed. */
export const NAV_GUIDE_DEFAULT: NavGuide = {
  followState: true,
  overlays: new Map(),
  skinGrid: false,
};

/** The height cutoff that switching the cutoff on starts at, in world units. */
export const NAV_CUTOFF_DEFAULT = 150;

/** Whether the overlay at `index` follows the shown layer mask under `guide`. */
export function followsState(model: MapNavGridModel, guide: NavGuide, index: number): boolean {
  return guide.followState && (model.overlays[index]?.flagBit ?? null) !== null;
}

/**
 * Returns the indices of the overlays that are on, in the order of the model's overlay list.
 *
 * An overlay that follows the state is on if `flags` has its bit. Every other overlay is on if
 * the reader switched it on.
 */
export function activeOverlays(model: MapNavGridModel, guide: NavGuide, flags: number): number[] {
  const active: number[] = [];

  model.overlays.forEach((overlay, index) => {
    const on = followsState(model, guide, index)
      ? (flags & (1 << (overlay.flagBit ?? 0))) !== 0
      : (guide.overlays.get(index) ?? false);

    if (on) active.push(index);
  });

  return active;
}

/** Returns `guide` with the switch of the overlay at `index` set to `on`. */
export function withOverlay(guide: NavGuide, index: number, on: boolean): NavGuide {
  const overlays = new Map(guide.overlays);
  overlays.set(index, on);
  return { ...guide, overlays };
}

/** Returns the guides that the outliner lists for `model` under `guide` and layer mask `flags`. */
export function guideOutlineOf(
  model: MapNavGridModel,
  guide: NavGuide,
  flags: number,
  navGridShown: boolean,
): GuideOutline {
  const active = activeOverlays(model, guide, flags);

  return {
    navGridShown,
    overlays: model.overlays.map((overlay, index) => ({
      label: overlay.label,
      on: active.includes(index),
      following: followsState(model, guide, index),
    })),
  };
}

/** Returns the grid file that the guide draws under `guide`, as `useNavGrid` picks it. */
export function drawnGridOf(model: MapNavGridModel, guide: NavGuide): AssetRef {
  return guide.skinGrid && model.skinGrid !== null ? model.skinGrid : model.grid;
}

/** Returns the region groups of `model` in the order that Color by lists them, gameplay first. */
export function colorGroupsOf(model: MapNavGridModel): NavRegionGroup[] {
  return [
    ...model.regionGroups.filter((group) => group.gameplay),
    ...model.regionGroups.filter((group) => !group.gameplay),
  ];
}

/**
 * Returns what the guide colors by for the persisted group name `name`.
 *
 * Falls back to terrain if `name` is null or if `model` has no group of that name.
 */
export function colorModeOf(model: MapNavGridModel, name: string | null): NavGridColorMode {
  const group = name === null ? undefined : model.regionGroups.find((each) => each.name === name);
  return group === undefined ? { kind: "terrain" } : { kind: "region", group };
}
