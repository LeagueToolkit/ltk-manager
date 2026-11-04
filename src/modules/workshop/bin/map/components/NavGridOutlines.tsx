import { BufferAttribute, BufferGeometry, type Color, LineBasicMaterial } from "three";

import { useDisposable } from "@/hooks";
import { AXIS_SIGN, type NavGrid, type SceneColors, useViewMode } from "@/modules/viewport";

import { NAV_OUTLINE_BITS, navCellOutlines } from "../utils/navOutlines";

/** Drawn under the markers and over the scene, as the region boundaries are. */
const OVER_THE_SCENE = 997;

export interface NavGridOutlinesProps {
  /** The grid of the shown map state, with its overlays written over it. */
  readonly grid: NavGrid;
  readonly colors: SceneColors;
}

/**
 * The outlines of the brush cells and the wall cells of a navigation grid, at the grid height,
 * drawn in the Conformance view mode only. Per section 3.7 of docs/plans/navgrid-guides.md.
 *
 * Brush draws in the green channel color and walls in the ink color. Both draw without the depth
 * test, so an outline under ground that is too high still shows.
 */
export function NavGridOutlines({ grid, colors }: NavGridOutlinesProps) {
  const shown = useViewMode().mode === "conformance";

  const brush = useDisposable(
    () => (shown ? lines(navCellOutlines(grid, NAV_OUTLINE_BITS.brush)) : null),
    [shown, grid],
  );
  const wall = useDisposable(
    () => (shown ? lines(navCellOutlines(grid, NAV_OUTLINE_BITS.wall)) : null),
    [shown, grid],
  );
  const brushMaterial = useDisposable(() => outlineMaterial(colors.axisY), [colors]);
  const wallMaterial = useDisposable(() => outlineMaterial(colors.ink), [colors]);

  if (brush === null || wall === null) return null;

  return (
    <group scale={[AXIS_SIGN[0], AXIS_SIGN[1], AXIS_SIGN[2]]}>
      <lineSegments
        geometry={wall}
        material={wallMaterial}
        renderOrder={OVER_THE_SCENE}
        frustumCulled={false}
      />
      <lineSegments
        geometry={brush}
        material={brushMaterial}
        renderOrder={OVER_THE_SCENE}
        frustumCulled={false}
      />
    </group>
  );
}

function lines(positions: Float32Array): BufferGeometry {
  const made = new BufferGeometry();
  made.setAttribute("position", new BufferAttribute(positions, 3));
  return made;
}

function outlineMaterial(color: Color): LineBasicMaterial {
  return new LineBasicMaterial({ color, depthTest: false, toneMapped: false });
}
