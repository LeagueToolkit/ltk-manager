import { BLEND_MODE, type BlendMode, QUAD_TYPE, UV_MODE } from "./enums";
import type { EmitterModel } from "./model";

/**
 * The emitters in the order the engine draws them, as a rank per emitter index.
 *
 * The engine's draw order: `pass` ascending, then the blend mode's rank, then
 * `miscRenderFlags` as a byte, then the emitter's own place. A position comparison sits
 * between the second and the third keys and compares the system's position, which every
 * emitter of one system shares.
 *
 * `isGroundLayer` puts an emitter in a display list of its own, and that list draws
 * before the default one.
 */
export function drawRanks(emitters: readonly EmitterModel[]): ReadonlyMap<number, number> {
  const order = [...emitters].sort(compareDrawOrder);
  return new Map(order.map((emitter, rank) => [emitter.index, rank]));
}

/** Negative where `left` draws before `right`, per the engine's comparator. */
export function compareDrawOrder(left: EmitterModel, right: EmitterModel): number {
  return (
    Number(right.groundLayer) - Number(left.groundLayer) ||
    left.pass - right.pass ||
    blendRank(left.blendMode) - blendRank(right.blendMode) ||
    left.miscRenderFlags - right.miscRenderFlags ||
    left.index - right.index
  );
}

/** The comparator's remap of each blend mode, in enum order. */
const BLEND_RANK = [1, 2, 1, 0, 2, 2, 2, 2, 3] as const;

function blendRank(mode: BlendMode): number {
  return BLEND_RANK[mode] ?? BLEND_RANK[BLEND_MODE.add];
}

/**
 * The emitter draws as a quad.
 *
 * A camera quad faces the eye, an arbitrary quad stands in the world, and a ray is a quad
 * laid along the particle's own `+Z` that turns to face the eye about that axis. An
 * emitter naming no primitive draws as a camera quad, because that is the kind the enum
 * defaults to.
 */
export function drawsAsQuad(emitter: EmitterModel): boolean {
  return (
    emitter.quadType === QUAD_TYPE.cameraQuad ||
    emitter.quadType === QUAD_TYPE.cameraUnitQuad ||
    emitter.quadType === QUAD_TYPE.arbitraryQuad ||
    emitter.quadType === QUAD_TYPE.ray
  );
}

/**
 * The emitter warps the screen behind it instead of drawing into the colour pass.
 *
 * Its geometry is whichever kind it already is, so it draws through the same path with
 * the distortion material and on the distortion layer. Decision 2.25 of
 * docs/plans/vfx-particle-renderer.md.
 */
export function distorts(emitter: EmitterModel): boolean {
  return emitter.distortion !== null;
}

/** The quad faces the eye rather than standing on its own orientation. */
export function facesTheCamera(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.cameraQuad || emitter.quadType === QUAD_TYPE.cameraUnitQuad;
}

/**
 * The quad spans half what every other kind spans, which is what makes it the unit.
 *
 * One builder serves both camera kinds and differs in one factor, `0.5` for
 * `CAMERA_UNIT_QUAD` against `1.0` for the rest, so a camera quad measures `2 * scale0`
 * across and this one measures `scale0`.
 */
export function isUnitQuad(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.cameraUnitQuad;
}

/**
 * The quad is a ray: its length lies along the particle's own `+Z`, never its travel.
 *
 * The kind is also excluded from `isDirectionOriented`, so a ray authored with no
 * rotation points along the emitter's `+Z` for good.
 */
export function isRay(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.ray;
}

/**
 * The emitter draws through `quad_ps_fixedalphauv`: a quad or a ribbon under `LOCK_ALPHA`.
 *
 * That bundle compiles no soft fade and no alpha erosion. Decisions 2.43 and 2.50 of
 * docs/plans/vfx-particle-renderer.md.
 */
export function drawsFixedAlphaUv(emitter: EmitterModel): boolean {
  return (
    emitter.uvMode === UV_MODE.lockAlpha &&
    emitter.quadType !== QUAD_TYPE.mesh &&
    emitter.quadType !== QUAD_TYPE.attachedMesh
  );
}

/** The emitter draws one ribbon through its live particles. */
export function drawsAsTrail(emitter: EmitterModel): boolean {
  return emitter.trail !== null;
}

/** The trail expands across the view rather than along each particle's own `+X`. */
export function trailFacesTheCamera(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.cameraTrail;
}

/**
 * The emitter draws a quad per particle from the system to its target.
 *
 * A beam that names a mesh has its ribbon suppressed and reaches no mesh draw, so it
 * draws nothing here either.
 */
export function drawsAsBeam(emitter: EmitterModel): boolean {
  return emitter.beam !== null && emitter.mesh === null;
}

/**
 * The emitter draws a mesh, which needs geometry before it draws anything.
 *
 * The plain kind alone draws what its definition names. The attached kind draws the
 * owner's own skinned mesh instead and never reads the three name fields, which is
 * [`drawsTheAttachment`].
 */
export function drawsAsMesh(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.mesh && emitter.mesh !== null;
}

/**
 * The emitter draws the character it is attached to, which a viewport has none of.
 *
 * The draw enumerates the owner's live skin render instances and copies each bone
 * palette per particle, so a name the definition carries is dead data.
 */
export function drawsTheAttachment(emitter: EmitterModel): boolean {
  return emitter.quadType === QUAD_TYPE.attachedMesh;
}

/**
 * The emitter names a primitive this build has no renderer for.
 *
 * A null `quadType` reaches here too, because a class with no kind matches none of the
 * predicates above.
 */
export function isUndrawn(emitter: EmitterModel): boolean {
  return (
    !drawsAsQuad(emitter) &&
    !drawsAsMesh(emitter) &&
    !drawsAsTrail(emitter) &&
    !drawsTheAttachment(emitter) &&
    emitter.beam === null
  );
}
