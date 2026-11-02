import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { MeshBasicMaterial, Plane, SphereGeometry, Vector3 } from "three";

import { useDisposable } from "@/hooks";
import type { PropertyEdit } from "@/lib/tauri";
import type { SceneColors } from "@/modules/viewport";

import type { PlacedItem } from "../utils/mapOutline";
import type { PlaceableRef } from "../utils/placeableEdits";
import {
  insertVertexEdits,
  LEAST_VERTICES,
  moveVertexEdits,
  removeVertexEdits,
  type Vertex,
} from "../utils/regionEdits";
import { localVertex, placeRegion } from "../utils/regionShapes";
import { grabGizmo } from "./PlaceableGizmo";

/** The radius of a vertex knob and of the knob on the middle of an edge, in world units. */
const VERTEX_RADIUS = 10;
const EDGE_RADIUS = 6;

/** The grid a snapped drag keeps a vertex to, in the region's own units. */
const GRID_STEP = 10;

/** Drawn over the map, since the handles are chrome rather than scene. */
const OVER_THE_SCENE = 1001;

/** The ground of the viewport, which a vertex drags along at its own height. */
const UP = new Vector3(0, 1, 0);

export interface RegionHandlesProps {
  /** The region whose vertices the handles stand on. */
  readonly placed: PlacedItem;
  /** The vertices as drawn, which a drag in progress has already moved. */
  readonly points: readonly Vertex[];
  /** The drag snaps to the grid, unless Ctrl is held. Off, Ctrl snaps it. */
  readonly snap: boolean;
  readonly colors: SceneColors;
  /** Told the vertices of each step of a drag, and null when a drag ends or is cancelled. */
  readonly onDrag: (points: readonly Vertex[] | null) => void;
  /** Sends the edits of a release, an insert or a removal as one undo step. */
  readonly onCommit: (edits: readonly PropertyEdit[]) => Promise<boolean>;
}

interface Drag {
  readonly index: number;
  /** The plane the vertex slides on: the ground through where it stood. */
  readonly plane: Plane;
  readonly cameraEnabled: boolean;
  moved: boolean;
}

/**
 * A knob on each vertex of the lead region, and a smaller one on the middle of each edge.
 * Dragging a vertex slides it along the ground at its own height and commits on release, a
 * click on an edge's knob inserts a vertex there, and Alt and a click on a vertex removes
 * it. Esc during a drag puts the vertex back. Per "Region boundaries" in
 * docs/ux/MAP_EDITOR.md.
 */
export function RegionHandles({
  placed,
  points,
  snap,
  colors,
  onDrag,
  onCommit,
}: RegionHandlesProps) {
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const [saving, setSaving] = useState(false);
  const drag = useRef<Drag | null>(null);
  const ref: PlaceableRef = { chunk: placed.chunk.entry, key: placed.item.key };
  const { transform } = placed.item;
  const { base } = placeRegion(points, 0, transform);

  const vertexGeometry = useDisposable(() => new SphereGeometry(VERTEX_RADIUS, 16, 12), []);
  const edgeGeometry = useDisposable(() => new SphereGeometry(EDGE_RADIUS, 12, 8), []);
  const vertexMaterial = useDisposable(
    () => new MeshBasicMaterial({ color: colors.gizmo, depthTest: false, transparent: true }),
    [colors.gizmo],
  );
  const edgeMaterial = useDisposable(
    () =>
      new MeshBasicMaterial({
        color: colors.wire,
        depthTest: false,
        transparent: true,
        opacity: 0.6,
      }),
    [colors.wire],
  );

  const setCamera = (enabled: boolean) => {
    if (controls !== null && "enabled" in controls) controls.enabled = enabled;
  };

  const release = (restore: boolean) => {
    const held = drag.current;
    if (held === null) return;

    drag.current = null;
    setCamera(held.cameraEnabled);
    if (restore) onDrag(null);
    invalidate();
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current !== null) {
        event.stopPropagation();
        releaseRef.current(true);
      }
    };
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("keydown", cancel, true);
      releaseRef.current(true);
    };
  }, []);

  const grab = (event: ThreeEvent<PointerEvent>, index: number) => {
    event.stopPropagation();
    grabGizmo();
    (event.target as unknown as Element).setPointerCapture(event.pointerId);
    const knob = base[index] as Vector3;
    drag.current = {
      index,
      plane: new Plane(UP, -knob.y),
      cameraEnabled: controls !== null && "enabled" in controls ? Boolean(controls.enabled) : true,
      moved: false,
    };
    setCamera(false);
  };

  const slide = (event: ThreeEvent<PointerEvent>) => {
    const held = drag.current;
    if (held === null) return;

    const hit = event.ray.intersectPlane(held.plane, new Vector3());
    if (hit === null) return;

    const was = points[held.index];
    if (was === undefined) return;

    const [x, , z] = localVertex(hit, transform);
    const snapped = snap !== (event.nativeEvent.ctrlKey || event.nativeEvent.metaKey);
    const vertex: Vertex = [grid(x, snapped), was[1], grid(z, snapped)];
    held.moved = true;
    onDrag(points.map((point, at) => (at === held.index ? vertex : point)));
  };

  const drop = async (event: ThreeEvent<PointerEvent>) => {
    const held = drag.current;
    if (held === null) return;

    event.stopPropagation();
    (event.target as unknown as Element).releasePointerCapture(event.pointerId);
    if (!held.moved) {
      release(false);
      if (event.nativeEvent.altKey && points.length > LEAST_VERTICES) {
        void onCommit(removeVertexEdits(ref, held.index));
      }
      return;
    }

    const vertex = points[held.index];
    if (vertex === undefined) {
      release(true);
      return;
    }

    setSaving(true);
    const committed = await onCommit(moveVertexEdits(ref, held.index, vertex));
    setSaving(false);
    release(!committed);
  };

  const split = (event: ThreeEvent<PointerEvent>, index: number) => {
    event.stopPropagation();
    grabGizmo();
    const here = points[index];
    const next = points[(index + 1) % points.length];
    if (here === undefined || next === undefined) return;

    const middle: Vertex = [
      (here[0] + next[0]) / 2,
      (here[1] + next[1]) / 2,
      (here[2] + next[2]) / 2,
    ];
    void onCommit(insertVertexEdits(ref, index + 1, middle));
  };

  return (
    <>
      {base.map((knob, index) => (
        <mesh
          key={`vertex-${index}`}
          geometry={vertexGeometry}
          material={vertexMaterial}
          position={knob}
          renderOrder={OVER_THE_SCENE}
          visible={!saving}
          onPointerDown={(event) => grab(event, index)}
          onPointerMove={slide}
          onPointerUp={(event) => void drop(event)}
        />
      ))}
      {base.map((knob, index) => (
        <mesh
          key={`edge-${index}`}
          geometry={edgeGeometry}
          material={edgeMaterial}
          position={knob.clone().lerp(base[(index + 1) % base.length] as Vector3, 0.5)}
          renderOrder={OVER_THE_SCENE}
          visible={!saving}
          onPointerDown={(event) => split(event, index)}
        />
      ))}
    </>
  );
}

/** `value` on the grid where `snapped`, else itself. */
function grid(value: number, snapped: boolean): number {
  return snapped ? Math.round(value / GRID_STEP) * GRID_STEP : value;
}
