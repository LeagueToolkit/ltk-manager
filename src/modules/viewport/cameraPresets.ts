/**
 * The cameras a preview draws through, "The viewer" in docs/ux/BIN_EDITOR.md.
 *
 * A preset is a direction, a screen up and a lens rather than a camera, so the scene
 * holds one camera per projection instead of one per preset.
 */

import { CHAMPION_HEIGHT, UNITS_PER_METRE } from "./space";

/** A point or a direction in the viewport's space. */
type Vector = readonly [number, number, number];

/** Which camera a preview draws through. */
export type CameraPreset = "game" | "orbit" | "top" | "front" | "side";

/** The presets in the order the camera menu lists them. */
export const CAMERA_PRESETS: readonly CameraPreset[] = ["game", "orbit", "top", "front", "side"];

/** Where the camera opens on, framing a champion-height effect at the origin. */
export const CAMERA = {
  position: [CHAMPION_HEIGHT * 1.4, CHAMPION_HEIGHT * 1.1, CHAMPION_HEIGHT * 2] as const,
  target: [0, CHAMPION_HEIGHT * 0.35, 0] as const,
  near: UNITS_PER_METRE / 50,
  far: UNITS_PER_METRE * 200,
  fov: 45,
};

/** The distances a wheel dollies between, in engine units off what the camera holds. */
export interface ZoomRange {
  readonly nearest: number;
  readonly farthest: number;
}

/** Where one preset looks from, which way is up on its screen, and the lens it looks through. */
export interface CameraStand {
  /** The preset holds a zoom where a perspective one holds a distance. */
  readonly orthographic: boolean;
  /** Which way the camera lies from what it looks at, a unit vector. */
  readonly look: Vector;
  /** Which way is up on screen, which a view down the world's own up needs its own. */
  readonly up: Vector;
  /** The vertical field of view in degrees, which an orthographic preset does not read. */
  readonly fov: number;
  /**
   * The distances the preset stands between, opening at the farthest, and null for a
   * preset that holds whatever distance the reader left and dollies freely.
   */
  readonly zoom: ZoomRange | null;
}

/**
 * The in-match camera's distance from what it holds, in engine units along its look.
 *
 * `CameraConfig.mZoomMinDistance` and `mZoomMaxDistance`, the meta defaults, which
 * `map11.bin` overrides neither of. A match opens zoomed out to the farthest.
 */
export const GAME_ZOOM: ZoomRange = { nearest: 1000, farthest: 2250 };

/**
 * The in-match camera's pitch below the horizontal, in degrees.
 *
 * The meta default of `DynamicCameraSettings` field `0x2446f2d0`, which `map11.bin`
 * does not override.
 */
const GAME_PITCH = 56;

/**
 * The in-match camera's field of view, in degrees.
 *
 * The meta default of `CameraConfig.ZoomFov`, which `map11.bin` does not override. That
 * the field is the vertical one rather than the horizontal is a reading the screen settles.
 */
const GAME_FOV = 40;

/**
 * The in-match camera looks along `+Z`, so it stands on the negative `Z` of what it holds.
 *
 * A unit at no yaw faces [`FORWARD`], which is `+Z`, and a match looks at a champion's
 * front. [`AXIS_SIGN`] mirrors `X` alone, so the engine's `+Z` is the viewport's and the
 * look vector carries no term for the change of basis. The reading is the screen's to
 * settle, as the field of view is.
 */
const GAME_LOOK: Vector = [
  0,
  Math.sin((GAME_PITCH * Math.PI) / 180),
  -Math.cos((GAME_PITCH * Math.PI) / 180),
];

/** The world's own up, which every preset but the one looking down it takes. */
const UP: Vector = [0, 1, 0];

/** Where a view down the up axis puts the screen's up, which is the world's `+Z`. */
const TOP_UP: Vector = [0, 0, 1];

/** Where each preset stands, and the lens it stands behind. */
export const CAMERA_STANDS: Record<CameraPreset, CameraStand> = {
  game: { orthographic: false, look: GAME_LOOK, up: UP, fov: GAME_FOV, zoom: GAME_ZOOM },
  orbit: { orthographic: false, look: openingLook(), up: UP, fov: CAMERA.fov, zoom: null },
  top: { orthographic: true, look: [0, 1, 0], up: TOP_UP, fov: CAMERA.fov, zoom: null },
  front: { orthographic: true, look: [0, 0, 1], up: UP, fov: CAMERA.fov, zoom: null },
  side: { orthographic: true, look: [1, 0, 0], up: UP, fov: CAMERA.fov, zoom: null },
};

/** The preset standing on `look`, and orbit for a look no flat preset stands on. */
export function presetFacing(look: Vector): CameraPreset {
  for (const preset of CAMERA_PRESETS) {
    const stand = CAMERA_STANDS[preset];
    if (stand.orthographic && stand.look.every((axis, at) => axis === look[at])) return preset;
  }
  return "orbit";
}

/** Which way is up on the screen of a camera looking along `look`. */
export function upAcross(look: Vector): Vector {
  return Math.abs(look[1]) === 1 ? TOP_UP : UP;
}

/** Which way [`CAMERA`] lies from what it opens on, a unit vector. */
export function openingLook(): Vector {
  return unit([
    CAMERA.position[0] - CAMERA.target[0],
    CAMERA.position[1] - CAMERA.target[1],
    CAMERA.position[2] - CAMERA.target[2],
  ]);
}

/** `vector` at unit length, and the world's `+Z` for one with no length to scale. */
function unit(vector: Vector): Vector {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
