import type { Vector3Tuple } from "three";

import type { CameraPreset } from "../utils/cameraPresets";

/** A camera's position, target and zoom under one preset, kept for the next viewport. */
export interface CameraPose {
  readonly preset: CameraPreset;
  readonly position: Vector3Tuple;
  readonly target: Vector3Tuple;
  /** The orthographic zoom, and one for a perspective pose. */
  readonly zoom: number;
}

/** The last pose of every viewport kind that keeps one, for the session. */
const POSES = new Map<string, CameraPose>();

/** The last pose recorded under `key`, when it was recorded under `preset`, and null otherwise. */
export function lastCameraPose(key: string, preset: CameraPreset): CameraPose | null {
  const pose = POSES.get(key);
  if (pose === undefined || pose.preset !== preset) return null;

  return pose;
}

/** Record `pose` as the pose the next viewport under `key` opens at. */
export function recordCameraPose(key: string, pose: CameraPose): void {
  POSES.set(key, pose);
}
