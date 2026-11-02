import { useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  SRGBColorSpace,
} from "three";

import { useDisposable } from "@/hooks";
import type { SceneColors } from "@/modules/viewport";

import { isHidden, type PlacedItem } from "../utils/mapOutline";
import type { Vertex } from "../utils/regionEdits";
import { placeRegion, regionLines, regionOf, regionWalls } from "../utils/regionShapes";

/** Drawn under the markers and over the scene, as the placeable shapes are. */
const OVER_THE_SCENE = 997;

/** How much of the ground the walls hide, since a region is a guide over the map. */
const WALL_OPACITY = 0.18;

/** The vertices a drag gives one region, in place of the ones the outline read. */
export interface DraggedVertices {
  readonly id: string;
  readonly points: readonly Vertex[];
}

export interface RegionBoundariesProps {
  readonly items: readonly PlacedItem[];
  readonly hidden: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  /** Every region draws. Off, the selected ones alone draw. */
  readonly shown: boolean;
  readonly colors: SceneColors;
  readonly dragged: DraggedVertices | null;
}

/**
 * Every region boundary of the listed placeables: its polygon in its line color, its walls
 * `DrawHeight` tall in its fill color, and a selected one in the selection color. A vertex
 * region with no height draws its polygon alone. Per "Region boundaries" in
 * docs/ux/MAP_EDITOR.md.
 */
export function RegionBoundaries({
  items,
  hidden,
  selected,
  shown,
  colors,
  dragged,
}: RegionBoundariesProps) {
  const { lines, walls } = useMemo(() => {
    const lines: number[] = [];
    const lineColors: number[] = [];
    const walls: number[] = [];
    const wallColors: number[] = [];
    const picked = new Color();

    for (const { id, chunk, item } of items) {
      const chosen = selected.has(id);
      if ((!shown && !chosen) || isHidden(hidden, chunk.entry, item.key)) continue;

      const found = regionOf(item.shape, item.transform);
      if (found === null) continue;

      const placed =
        dragged?.id === id
          ? placeRegion(dragged.points, found.region?.height ?? 0, item.transform)
          : found.placed;
      const line = chosen
        ? colors.gizmo
        : found.region === null
          ? colors.markerOther
          : byteColor(picked, found.region.lineColor);
      const fill = chosen ? colors.gizmo : byteColor(picked, found.region?.fillColor ?? [0, 0, 0]);

      const edge = regionLines(placed);
      lines.push(...edge);
      pushColor(lineColors, line, edge.length / 3);

      const wall = regionWalls(placed);
      walls.push(...wall);
      pushColor(wallColors, fill, wall.length / 3);
    }

    return {
      lines: { positions: lines, colors: lineColors },
      walls: { positions: walls, colors: wallColors },
    };
  }, [items, hidden, selected, shown, colors, dragged]);

  const lineGeometry = useDisposable(() => colored(lines.positions, lines.colors), [lines]);
  const wallGeometry = useDisposable(() => colored(walls.positions, walls.colors), [walls]);
  const lineMaterial = useDisposable(
    () => new LineBasicMaterial({ vertexColors: true, depthTest: false }),
    [],
  );
  const wallMaterial = useDisposable(
    () =>
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: WALL_OPACITY,
        side: DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  return (
    <>
      <mesh geometry={wallGeometry} material={wallMaterial} frustumCulled={false} />
      <lineSegments
        geometry={lineGeometry}
        material={lineMaterial}
        renderOrder={OVER_THE_SCENE}
        frustumCulled={false}
      />
    </>
  );
}

/** `into` set to the bytes `[r, g, b]` of a bin color, which the client reads as sRGB. */
function byteColor(into: Color, [r, g, b]: readonly number[]): Color {
  return into.setRGB((r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255, SRGBColorSpace);
}

function pushColor(out: number[], color: Color, points: number) {
  for (let at = 0; at < points; at += 1) out.push(color.r, color.g, color.b);
}

function colored(positions: readonly number[], colors: readonly number[]): BufferGeometry {
  const made = new BufferGeometry();
  made.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  made.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  return made;
}
