import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MapNavGridModel, NavGridSource } from "@/lib/tauri";
import {
  applyOverlays,
  type NavGrid,
  type NavGridOverlay,
  viewportQueries,
} from "@/modules/viewport";

import { activeOverlays, type NavGuide } from "../utils/navGuide";

/** The navigation grid of the shown map state, composed from its base grid and overlays. */
export interface NavGridView {
  readonly model: MapNavGridModel;
  /** The grid that the guide draws, with the overlays that are on written over it. */
  readonly grid: NavGrid;
  /** The grid as its file holds it. */
  readonly base: NavGrid;
  /** The indices of the overlays that are on, in list order. Each has been written into `grid`. */
  readonly active: readonly number[];
  /** Where the drawn grid file came from. */
  readonly source: NavGridSource;
}

/**
 * Returns the navigation grid of the shown map state, or null until the grid file arrives.
 *
 * `flags` is the shown visibility layer mask. The overlays apply in list order, the flag file
 * before the region file of each, per ADR-0079. An overlay file that has not arrived is left out
 * until it does.
 */
export function useNavGrid(
  model: MapNavGridModel | null,
  guide: NavGuide,
  flags: number,
): NavGridView | null {
  const source: NavGridSource = guide.skinGrid && model?.skinGrid != null ? "skin" : "container";
  const asset = model === null ? null : source === "skin" ? model.skinGrid : model.grid;
  const base = useQuery(viewportQueries.navGrid(asset ?? null)).data;

  const active = useMemo(
    () => (model === null ? [] : activeOverlays(model, guide, flags)),
    [model, guide, flags],
  );
  const files = useMemo(
    () =>
      model === null
        ? []
        : active.flatMap((index) => [model.overlays[index].flags, model.overlays[index].regions]),
    [model, active],
  );
  const overlays = useQueries({
    queries: files.map((file) => viewportQueries.navGrid(file ?? null)),
    combine: (results) =>
      results.flatMap((result): NavGridOverlay[] =>
        result.data?.kind === "overlay" ? [result.data.overlay] : [],
      ),
  });

  return useMemo(() => {
    if (model === null || base?.kind !== "grid") return null;

    return {
      model,
      grid: overlays.length === 0 ? base.grid : applyOverlays(base.grid, overlays),
      base: base.grid,
      active,
      source,
    };
  }, [model, base, overlays, active, source]);
}
