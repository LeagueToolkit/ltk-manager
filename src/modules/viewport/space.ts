/**
 * The space the viewport takes the engine's world to be, in numbers alone.
 *
 * "Before T0" in docs/plans/vfx-particle-renderer.md names six values every tier rests
 * on. The four that are plain numbers live here, apart from the colour spaces in
 * `world.ts`, so the simulation reads them without the renderer they belong to.
 *
 * Two of the six are attested. `isFollowingTerrain` moves a particle's Y toward the
 * terrain height, which puts the engine's up on Y, and the mirrored X a `.skn` takes on
 * the way into Maya or Blender is what makes it left-handed against ThreeJS. The scale
 * is the assumption a reference screenshot settles.
 */

/**
 * What a position read out of a bin is multiplied by to reach the viewport's space.
 *
 * Both spaces are Y up, so the change of basis is one mirrored axis and the up axis
 * itself needs no term.
 */
export const AXIS_SIGN: readonly [number, number, number] = [-1, 1, 1];

/**
 * The axis a unit faces along at no yaw, in the engine's own space.
 *
 * A unit's system is yawed to face its travel on `atan2(dx, dz)` over the flat delta, so
 * the row the yaw leaves facing is `+Z`. A missile carries its own game object's frame
 * instead, which shipped data puts on `Y`, `flightInto` in basis.ts.
 */
export const FORWARD: readonly [number, number, number] = [0, 0, 1];

/** The flat ground's height on the up axis, which a ground-layer emitter is laid on. */
export const GROUND_LEVEL = 0;

/** Engine units in one metre, which sets the camera's near plane and the grid's pitch. */
export const UNITS_PER_METRE = 100;

/** A champion's height in engine units, which is the frame a new viewport opens on. */
export const CHAMPION_HEIGHT = 200;
