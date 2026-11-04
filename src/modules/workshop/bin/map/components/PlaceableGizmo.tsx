import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { Group, type Matrix4, Vector3 } from "three";

import { AXIS_SIGN, type NavGrid } from "@/modules/viewport";

import type { GizmoTool } from "../state/mapScene";
import { snapToNavCell } from "../utils/navCells";
import { type Moved, movesOf, type Positioned, viewportMatrix } from "../utils/placeableSpace";

const MIRROR = new Vector3(...AXIS_SIGN);

const MODE: Record<GizmoTool, "translate" | "rotate" | "scale"> = {
  move: "translate",
  rotate: "rotate",
  scale: "scale",
};

/* A press on a handle, which the canvas's click reads and lets go of, so a press on the gizmo
   picks nothing behind it. */
let grabbed = false;

/** Records a press on a viewport handle, so the click that ends it picks nothing. */
export function grabGizmo(): void {
  grabbed = true;
}

/** Whether the last press went to a gizmo handle. Reading it lets go of it. */
export function takeGizmoGrab(): boolean {
  const was = grabbed;
  grabbed = false;
  return was;
}

/** The grid a snapped drag keeps to: units, radians and a scale factor. */
const GRID_STEP = 10;
const ANGLE_STEP = (15 * Math.PI) / 180;
const SCALE_STEP = 0.1;

interface Props {
  /** The selection, the lead first, which the gizmo stands on. */
  readonly items: readonly Positioned[];
  readonly tool: GizmoTool;
  readonly space: "world" | "local";
  /** The drag snaps to the grid, unless Ctrl is held. Off, Ctrl snaps it. */
  readonly snap: boolean;
  /** The navgrid whose cell centers a move snaps to, and null while Guides snapping is off. */
  readonly guideGrid: NavGrid | null;
  readonly onCommit: (moves: readonly Moved[]) => Promise<boolean>;
  /** Told the moves of each step of a drag, and null when a drag is cancelled or refused. */
  readonly onDrag: (moves: readonly Moved[] | null) => void;
}

/**
 * A gizmo on the lead placeable or mesh that moves, turns or scales the whole selection. A drag
 * reports each step through `onDrag` and sends nothing. The release sends one edit for every
 * item, and Esc during a drag puts the gizmo and the selection back. Per "The gizmo commits on
 * release" in docs/ux/MAP_EDITOR.md.
 */
export function PlaceableGizmo({ items, tool, space, snap, guideGrid, onCommit, onDrag }: Props) {
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const object = useMemo(() => new Group(), []);
  const transform = useRef<ComponentRef<typeof TransformControls>>(null);
  const [saving, setSaving] = useState(false);
  const [inverted, setInverted] = useState(false);
  const snapped = snap !== inverted;

  useEffect(() => {
    const press = (event: KeyboardEvent) => setInverted(event.ctrlKey || event.metaKey);
    window.addEventListener("keydown", press);
    window.addEventListener("keyup", press);
    return () => {
      window.removeEventListener("keydown", press);
      window.removeEventListener("keyup", press);
    };
  }, []);
  const drag = useRef<{ start: Matrix4 } | null>(null);
  const lead = items[0];

  /* The gizmo stands where the lead does, read back each time the outline answers. */
  useEffect(() => {
    if (lead === undefined) return;

    viewportMatrix(lead.anchor ?? lead.transform).decompose(
      object.position,
      object.quaternion,
      object.scale,
    );
    object.updateMatrix();
    object.updateMatrixWorld();
    invalidate();
  }, [lead, object, invalidate]);

  /* `TransformControls` turns the default camera controls off and on through `dragging-changed`,
     so a release leaves them alone. A gizmo removed mid-drag never sees the mouse-up, and turns
     the camera back on itself. */
  function release(restore: boolean, unmounting = false) {
    const held = drag.current;
    if (held === null) return;

    drag.current = null;
    if (restore) {
      held.start.decompose(object.position, object.quaternion, object.scale);
      object.updateMatrix();
      transform.current?.reset();
      onDrag(null);
    }
    if (unmounting && controls !== null && "enabled" in controls) controls.enabled = true;
    invalidate();
  }

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
      releaseRef.current(true, true);
    };
  }, []);

  function change() {
    const held = drag.current;
    if (held === null) return;

    /* The controls set the position from the drag start on every step, so a snapped position
       does not carry into the next step. */
    if (tool === "move" && guideGrid !== null) {
      const engine = object.position.clone().multiply(MIRROR);
      const snapped = snapToNavCell(guideGrid, [engine.x, engine.y, engine.z]);
      if (snapped !== null) object.position.set(...snapped).multiply(MIRROR);
    }

    object.updateMatrix();
    onDrag(movesOf(items, held.start, object.matrix));
  }

  async function finish() {
    const held = drag.current;
    if (held === null) return;

    object.updateMatrix();
    const after = object.matrix.clone();
    if (after.equals(held.start)) {
      release(false);
      onDrag(null);
      return;
    }

    setSaving(true);
    const committed = await onCommit(movesOf(items, held.start, after));
    setSaving(false);
    release(!committed);
  }

  if (lead === undefined) return null;

  return (
    <>
      <primitive object={object} />
      <TransformControls
        ref={transform}
        enabled={!saving}
        object={object}
        mode={MODE[tool]}
        space={space}
        translationSnap={snapped ? GRID_STEP : null}
        rotationSnap={snapped ? ANGLE_STEP : null}
        scaleSnap={snapped ? SCALE_STEP : null}
        onMouseDown={() => {
          grabGizmo();
          object.updateMatrix();
          drag.current = { start: object.matrix.clone() };
        }}
        onObjectChange={change}
        onMouseUp={() => {
          void finish();
        }}
      />
    </>
  );
}
