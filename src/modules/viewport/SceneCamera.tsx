import { CameraControls, type CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { useReducedMotion } from "@/hooks";

import {
  CAMERA,
  CAMERA_STANDS,
  type CameraPreset,
  type CameraStand,
  presetFacing,
  upAcross,
  type ZoomRange,
} from "./cameraPresets";
import { reachOfZoom, zoomOfReach } from "./framing";
import { type Look, OrientationGizmo } from "./OrientationGizmo";
import type { SceneColors } from "./sceneColors";
import { CHAMPION_HEIGHT } from "./world";

/** Where a camera stands before anything has been framed in it. */
const OPENING_REACH = CHAMPION_HEIGHT * 3;

/** How long a drag trails the pointer, which is short enough to read as direct. */
const DRAG_SMOOTHING = 0.06;

/** How far a free preset dollies: off the near plane, and short of the far. */
const FREE_ZOOM: ZoomRange = { nearest: CAMERA.near * 4, farthest: CAMERA.far / 2 };

/** The two projections a preset draws through. */
type Projected = OrthographicCamera | PerspectiveCamera;

/** Scratch a stand is measured in. */
const POSITION = new Vector3();
const TARGET = new Vector3();

export interface SceneCameraProps {
  readonly preset: CameraPreset;
  readonly colors: SceneColors;
  /** The reader stood the camera off its preset: on Orbit by a drag, on a gizmo head's. */
  readonly onStand?: (preset: CameraPreset) => void;
}

/**
 * The camera of the preset in view, with orbit, pan and dolly over it and the gizmo beside.
 *
 * One camera per projection written into the scene's state, rather than the canvas's own
 * `camera` and `orthographic` props: ThreeJS's fibre reads those once, so a preset that
 * moved either would remount the canvas and every texture and buffer under it. Only the
 * swap between the two projections rebuilds the controls, which carry across it where the
 * camera stood and, through `reachOfZoom`, how much of the scene it showed.
 *
 * A drag holds the projection it started in until it ends, so a drag off a flat preset
 * is one gesture rather than two, and the swap to Orbit lands on the release.
 */
export function SceneCamera({ preset, colors, onStand }: SceneCameraProps) {
  const size = useThree((state) => state.size);
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const reduceMotion = useReducedMotion();

  const perspective = useMemo(
    () => new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far),
    [],
  );
  const orthographic = useMemo(
    () => new OrthographicCamera(-1, 1, 1, -1, CAMERA.near, CAMERA.far),
    [],
  );
  const stand = CAMERA_STANDS[preset];
  const [dragging, setDragging] = useState<Projected | null>(null);
  const camera = dragging ?? (stand.orthographic ? orthographic : perspective);

  const controls = useRef<CameraControlsImpl>(null);
  const stood = useRef<CameraPreset | null>(null);
  const standing = useRef(onStand);
  standing.current = onStand;
  const animated = useRef(!reduceMotion);
  animated.current = !reduceMotion;

  /* Where the last projection's controls left the camera, which the next takes up. */
  const held = useRef({
    position: new Vector3(...CAMERA.position),
    target: new Vector3(...CAMERA.target),
    zoom: 1,
  });

  useEffect(() => {
    set({ camera });
  }, [camera, set]);

  /* The fibre sizes the camera it made itself, and only as the canvas resizes, so a
     camera swapped in between two resizes carries the frustum of neither. */
  useEffect(() => {
    frustumInto(camera, size.width, size.height);
  }, [camera, size]);

  useEffect(() => {
    const current = controls.current;
    if (current === null) return;
    const kept = held.current;
    const { height } = get().size;

    const along = POSITION.copy(kept.position).sub(kept.target);
    const reach = along.length() || OPENING_REACH;
    along.divideScalar(reach);
    camera.up.set(...upAcross([along.x, along.y, along.z]));
    current.updateCameraUp();

    if (camera instanceof OrthographicCamera) {
      void current.zoomTo(zoomOfReach(reach, height, perspective.fov), false);
      POSITION.copy(kept.position);
    } else {
      const reached = reachOfZoom(kept.zoom, height, camera.fov);
      POSITION.copy(kept.target).addScaledVector(along, reached);
    }
    const { x, y, z } = kept.target;
    void current.setLookAt(POSITION.x, POSITION.y, POSITION.z, x, y, z, false);

    return () => {
      current.getPosition(kept.position);
      current.getTarget(kept.target);
      kept.zoom = camera.zoom;
    };
  }, [camera, get, perspective]);

  useEffect(() => {
    const current = controls.current;
    if (current === null || stood.current === preset) return;
    stood.current = preset;
    standOn(camera, current, stand, stand.look, animated.current);
  }, [camera, preset, stand]);

  /* A pick of the axis the camera already stands on turns it to the other end, which is
     how the gizmo reaches the three views it has no face for. */
  const onLook = (picked: Look) => {
    const current = controls.current;
    if (current === null) return;
    const look = standsOn(current, picked) ? negated(picked) : picked;
    const facing = presetFacing(look);
    stood.current = facing;
    standOn(camera, current, CAMERA_STANDS[facing], look, animated.current);
    standing.current?.(facing);
  };

  const zoom = stand.zoom ?? FREE_ZOOM;

  return (
    <>
      <CameraControls
        ref={controls}
        camera={camera}
        makeDefault
        dollyToCursor
        minDistance={zoom.nearest}
        maxDistance={zoom.farthest}
        draggingSmoothTime={reduceMotion ? 0 : DRAG_SMOOTHING}
        onControlStart={() => {
          setDragging(camera);
          stood.current = "orbit";
          standing.current?.("orbit");
        }}
        onControlEnd={() => setDragging(null)}
      />
      <OrientationGizmo colors={colors} onLook={onLook} />
    </>
  );
}

/**
 * Aim `camera` from where `look` lies, through the lens of `stand`, at its distance.
 *
 * A stand with a zoom of its own opens at the farthest of it. Any other holds the
 * distance the reader was already at, since a fit is what sets one, and a preset picked
 * before anything is framed opens a champion's reach off its target.
 */
function standOn(
  camera: Projected,
  controls: CameraControlsImpl,
  stand: CameraStand,
  look: Look,
  animated: boolean,
): void {
  const target = controls.getTarget(TARGET);
  const held = controls.getPosition(POSITION).distanceTo(target) || OPENING_REACH;
  const reach = stand.zoom?.farthest ?? held;

  camera.up.set(...upAcross(look));
  controls.updateCameraUp();
  if (camera instanceof PerspectiveCamera) {
    camera.fov = stand.fov;
    camera.updateProjectionMatrix();
  }

  void controls.setLookAt(
    target.x + look[0] * reach,
    target.y + look[1] * reach,
    target.z + look[2] * reach,
    target.x,
    target.y,
    target.z,
    animated,
  );
}

/** Under this much off `look`, the camera is taken to stand on it already. */
const STANDS_ON = 0.999;

/** Whether the camera lies from its target along `look` already, read at the end of any move. */
function standsOn(controls: CameraControlsImpl, look: Look): boolean {
  const along = controls.getPosition(POSITION).sub(controls.getTarget(TARGET)).normalize();
  return along.x * look[0] + along.y * look[1] + along.z * look[2] > STANDS_ON;
}

function negated(look: Look): Look {
  return [-look[0], -look[1], -look[2]];
}

/** `camera`'s projection sized to a canvas `width` by `height` pixels. */
function frustumInto(camera: Projected, width: number, height: number): void {
  if (camera instanceof OrthographicCamera) {
    camera.left = width / -2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = height / -2;
  } else {
    camera.aspect = height > 0 ? width / height : 1;
  }
  camera.updateProjectionMatrix();
}
