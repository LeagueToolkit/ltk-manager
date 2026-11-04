import type { MapTool } from "../state/mapScene";
import type { PlacedItem } from "./mapOutline";
import type { Vertex } from "./regionEdits";

/** The vertices of the lead's polygon, and whether they drag or only show where they stand. */
export interface LeadVertices {
  readonly points: readonly Vertex[];
  readonly access: "drag" | "show";
}

/**
 * Returns the vertices of `lead`'s polygon, and null for a placeable of another shape.
 *
 * They drag on a region boundary of an editable map under Select or Move, since a boundary's
 * `Vertices` are the field the vertex edits write. They show on any other polygon, such as a
 * light region or a region guide, on a read-only map and under the other tools. Per "Region
 * boundaries" in docs/ux/MAP_EDITOR.md.
 */
export function leadVertices(
  lead: PlacedItem | null,
  editable: boolean,
  tool: MapTool,
): LeadVertices | null {
  const shape = lead?.item.shape ?? null;
  if (shape === null || (shape.type !== "region" && shape.type !== "polygon")) return null;

  const points = shape.points.map(([x, y, z]): Vertex => [x ?? 0, y ?? 0, z ?? 0]);
  const drags = editable && lead?.item.kind === "region" && (tool === "select" || tool === "move");
  return { points, access: drags ? "drag" : "show" };
}
