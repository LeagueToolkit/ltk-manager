import type { CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect } from "react";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { useReducedMotion } from "@/hooks";

import { CAMERA, CAMERA_STANDS } from "./cameraPresets";
import { type Bounds, framing, orthographicFraming } from "./framing";
import { useCameraPreset } from "./presetContext";

/** A point in the viewport's space. */
type Point = readonly [number, number, number];

export interface FitCameraProps {
  /** What the camera holds, and null to leave it where it opened. */
  readonly bounds: Bounds | null;
  /** The ground under what it holds, which the match camera stands off instead. */
  readonly ground: Point;
  /** Bumped to frame the bounds again, which is what a reset of the view asks for. */
  readonly token: number;
}

/**
 * The camera moved to hold `bounds`, when they first arrive and on every new token.
 *
 * The pane's size is read at the moment of framing rather than followed, so a resize
 * keeps whatever orbit the reader left.
 */
export function FitCamera({ bounds, ground, token }: FitCameraProps) {
  const fit = useFitCamera();

  useEffect(() => {
    fit(bounds, ground);
  }, [bounds, fit, ground, token]);

  return null;
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
 */
export function useFitCamera(): (bounds: Bounds | null, ground: Point) => void {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null;
  const get = useThree((state) => state.get);
  const preset = useCameraPreset();
  const reduceMotion = useReducedMotion();

  return useCallback(
    (bounds: Bounds | null, ground: Point) => {
      if (bounds === null || controls === null) return;
      const { width, height } = get().size;
      const animated = !reduceMotion;

      const stand = CAMERA_STANDS[preset];
      if (stand.zoom !== null) {
        const reach = stand.zoom.farthest;
        void controls.setLookAt(
          ground[0] + stand.look[0] * reach,
          ground[1] + stand.look[1] * reach,
          ground[2] + stand.look[2] * reach,
          ...ground,
          animated,
        );
        return;
      }

      const look = lookOf(camera, controls);
      if (camera instanceof OrthographicCamera) {
        const framed = orthographicFraming(bounds, width, height, look);
        void controls.zoomTo(framed.zoom, animated);
        void controls.setLookAt(...framed.position, ...framed.target, animated);
      } else {
        const fov = camera instanceof PerspectiveCamera ? camera.fov : CAMERA.fov;
        const framed = framing(bounds, fov, height > 0 ? width / height : 1, look);
        void controls.setLookAt(...framed.position, ...framed.target, animated);
      }
    },
    [camera, controls, get, preset, reduceMotion],
  );
}

/** Scratch the look is measured in, one per module rather than one per fit. */
const POSITION = new Vector3();
const TARGET = new Vector3();

/** Which way the camera will lie from its target, and where it faces for one standing on it. */
function lookOf(
  camera: OrthographicCamera | PerspectiveCamera,
  controls: CameraControlsImpl,
): readonly [number, number, number] {
  controls.getPosition(POSITION).sub(controls.getTarget(TARGET));
  if (POSITION.lengthSq() === 0) camera.getWorldDirection(POSITION).negate();
  return [POSITION.x, POSITION.y, POSITION.z];
}
