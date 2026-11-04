import { useQuery } from "@tanstack/react-query";

import { type NavGrid, viewportQueries } from "@/modules/viewport";

import { useMapScene } from "../state/mapScene";
import { drawnGridOf } from "../utils/navGuide";

/**
 * Returns the grid that the navgrid guide draws, as its file holds it, or null until it arrives
 * or where the map has no navgrid.
 *
 * A cell's center and height do not depend on the overlays, so framing a cell reads this grid
 * rather than composing the shown state again.
 */
export function useNavGridBase(): NavGrid | null {
  const { backdrop, navGuide } = useMapScene();
  const model = backdrop.navGrid;
  const asset = model === null ? null : drawnGridOf(model, navGuide);
  const file = useQuery(viewportQueries.navGrid(asset)).data;

  return file?.kind === "grid" ? file.grid : null;
}
