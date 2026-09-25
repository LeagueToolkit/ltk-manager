import type { CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { Frustum, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { useReducedMotion } from "@/hooks";

import { useCameraPreset } from "../state/presetContext";
import { CAMERA, CAMERA_STANDS } from "../utils/cameraPresets";
import { type Bounds, boxFraming, framing, orthographicFraming } from "../utils/framing";
import { lookAtShortest } from "../utils/lookAt";

/** A point in the viewport's space. */
type Point = readonly [number, number, number];

export interface FitCameraProps {
  /** Camera transitions animate unless the surface is capturing a still. */
  readonly animate?: boolean;
  /** Perspective frames fit a sphere by default, or the projected box for thumbnail artwork. */
  readonly fit?: "sphere" | "box";
  /** What the camera holds, measured off `ground`, and null to leave it where it opened. */
  readonly bounds: Bounds | null;
  /** Where what it holds stands, which the match camera stands off instead. */
  readonly ground: Point;
  /** Bumped to frame the bounds again, which is what a reset of the view asks for. */
  readonly token: number;
}

/**
 * The camera moved to hold `bounds`: as they arrive, on a new token, on a preset picked.
 *
 * A subject that moves carries the camera with it rather than framing again, so the view
 * the reader left holds through a drag of the subject and a change of map. The turn to
 * Orbit frames nothing either, since it is the reader's own drag that makes it.
 *
 * The pane's size is read at the moment of framing rather than followed, so a resize
 * keeps whatever orbit the reader left.
 */
export function FitCamera({
  bounds,
  ground,
  token,
  animate = true,
  fit: shape = "sphere",
}: FitCameraProps) {
  const fit = useFitCamera(animate, shape);
  const preset = useCameraPreset();
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null;
  const stood = useRef(ground);
  stood.current = ground;
  const framed = useRef<{ bounds: Bounds; token: number; ground: Point } | null>(null);

  useEffect(() => {
    if (bounds === null) return;
    const last = framed.current;
    const asked = last === null || last.bounds !== bounds || last.token !== token;
    if (!asked && preset === "orbit") return;
    const at = stood.current;
    if (fit(placed(bounds, at), at)) framed.current = { bounds, token, ground: at };
  }, [bounds, fit, preset, token]);

  useEffect(() => {
    const last = framed.current;
    if (last === null || controls === null) return;
    const shift = ground.map((value, axis) => value - last.ground[axis]);
    if (shift.every((value) => value === 0)) return;
    last.ground = ground;
    const position = controls.getPosition(POSITION);
    const target = controls.getTarget(TARGET);
    void controls.setLookAt(
      position.x + shift[0],
      position.y + shift[1],
      position.z + shift[2],
      target.x + shift[0],
      target.y + shift[1],
      target.z + shift[2],
      false,
    );
  }, [controls, ground]);

  return null;
}

/** `bounds` moved to where `ground` stands them. */
function placed(bounds: Bounds, ground: Point): Bounds {
  return {
    min: bounds.min.map((value, axis) => value + ground[axis]) as [number, number, number],
    max: bounds.max.map((value, axis) => value + ground[axis]) as [number, number, number],
  };
}

/**
 * Frame a box in the scene's own camera, along the direction that camera already looks.
 *
 * The direction is the camera's rather than a preset's, so a fit of a preset holds that
 * preset's angle, which `SceneCamera` has already stood the camera at, and a fit of a
 * view the reader dragged holds where they left it. A stand still under way is read at
 * its end, so a fit asked with a preset lands on that preset.
 *
 * A preset with a zoom of its own, which is the match camera, frames nothing: it stands
 * its farthest zoom off `ground`, as the game stands off a champion's feet.
 *
 * Answers whether it framed, which it cannot before the scene has its controls.
 */
export function useFitCamera(
  animate = true,
  shape: "sphere" | "box" = "sphere",
): (bounds: Bounds | null, ground: Point) => boolean {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null;
  const get = useThree((state) => state.get);
  const preset = useCameraPreset();
  const reduceMotion = useReducedMotion();

  return useCallback(
    (bounds: Bounds | null, ground: Point) => {
      if (bounds === null || controls === null) return false;
      const { width, height } = get().size;
      const animated = animate && !reduceMotion;

      const stand = CAMERA_STANDS[preset];
      if (stand.zoom !== null) {
        const reach = stand.zoom.farthest;
        lookAtShortest(
          controls,
          [
            ground[0] + stand.look[0] * reach,
            ground[1] + stand.look[1] * reach,
            ground[2] + stand.look[2] * reach,
          ],
          ground,
          animated,
        );
        return true;
      }

      const look = lookOf(camera, controls);
      if (camera instanceof OrthographicCamera) {
        const framed = orthographicFraming(bounds, width, height, look);
        void controls.zoomTo(framed.zoom, animated);
        lookAtShortest(controls, framed.position, framed.target, animated);
      } else {
        const fov = camera instanceof PerspectiveCamera ? camera.fov : CAMERA.fov;
        const aspect = height > 0 ? width / height : 1;
        const framed =
          shape === "box"
            ? boxFraming(bounds, fov, aspect, look, [camera.up.x, camera.up.y, camera.up.z])
            : framing(bounds, fov, aspect, look);
        lookAtShortest(controls, framed.position, framed.target, animated);
      }
      return true;
    },
    [camera, controls, get, preset, reduceMotion, animate, shape],
  );
}

/**
 * Whether the scene's camera shows the middle of `bounds`, and null before it has controls.
 *
 * The pose is read off the controls rather than the camera, whose matrices lag a pose set
 * this frame.
 */
export function useSeesBounds(): (bounds: Bounds | null) => boolean | null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null;

  return useCallback(
    (bounds: Bounds | null) => {
      if (bounds === null || controls === null) return null;
      if (!(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera)) {
        return null;
      }

      const probe = camera.clone();
      probe.position.copy(controls.getPosition(POSITION));
      probe.lookAt(controls.getTarget(TARGET));
      probe.updateMatrixWorld();
      probe.updateProjectionMatrix();
      SEEN.setFromProjectionMatrix(
        VIEW.multiplyMatrices(probe.projectionMatrix, probe.matrixWorldInverse),
      );

      MIDDLE.set(
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      );
      return SEEN.containsPoint(MIDDLE);
    },
    [camera, controls],
  );
}

/** Scratch the look is measured in, one per module rather than one per fit. */
const POSITION = new Vector3();
const TARGET = new Vector3();
const MIDDLE = new Vector3();
const VIEW = new Matrix4();
const SEEN = new Frustum();

/** Which way the camera will lie from its target, and where it faces for one standing on it. */
function lookOf(
  camera: OrthographicCamera | PerspectiveCamera,
  controls: CameraControlsImpl,
): readonly [number, number, number] {
  controls.getPosition(POSITION).sub(controls.getTarget(TARGET));
  if (POSITION.lengthSq() === 0) camera.getWorldDirection(POSITION).negate();
  return [POSITION.x, POSITION.y, POSITION.z];
}
