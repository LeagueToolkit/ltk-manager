import type { VfxValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  BEAM_MODE,
  FIXED_ORBIT,
  QUAD_TYPE,
  SIMPLE_ORIENTATION,
  type SimpleOrientation,
  TRAIL_MODE,
  TRAIL_SMOOTHING,
} from "./enums";
import {
  type BeamModel,
  type FieldsModel,
  type LegacySimpleModel,
  type LingerModel,
  POINT_SHAPE,
  type SpawnShape,
  type TrailModel,
  type ValueCurve,
} from "./model";
import {
  components,
  constant,
  curve,
  curves,
  DEFAULT,
  enumByte,
  field,
  flag,
  flagOr,
  number,
  pair,
  pairOr,
  quadType,
  triple,
} from "./readValue";
import type { Point } from "./rig";

/**
 * The fields of `primitive` a trail's and a beam's readers open, which are the
 * primitive's own rather than the emitter's.
 */
const PRIMITIVE_FIELD = {
  trail: nameHash("mTrail"),
  beam: nameHash("mBeam"),
} as const;

/**
 * The five concrete `IVfxShape` classes, and the pre-split `VfxShape` old data still carries.
 *
 * `VfxShapePointDoNotUse` is a hash crack rather than an attested string, and the hash is
 * what a bin writes.
 */
const SHAPE_CLASS = {
  point: nameHash("VfxShapePointDoNotUse"),
  legacy: nameHash("VfxShapeLegacy"),
  old: nameHash("VfxShape"),
  box: nameHash("VfxShapeBox"),
  cylinder: nameHash("VfxShapeCylinder"),
  sphere: nameHash("VfxShapeSphere"),
} as const;

/** The shapes' own fields. `radius` is one hash on the sphere and the cylinder alike. */
const SHAPE = {
  emitOffset: nameHash("emitOffset"),
  birthTranslation: nameHash("birthTranslation"),
  angles: nameHash("emitRotationAngles"),
  axes: nameHash("emitRotationAxes"),
  size: nameHash("Size"),
  radius: nameHash("radius"),
  height: nameHash("height"),
  flags: nameHash("flags"),
} as const;

/** `VfxShapeVolume.flags`: the shape fills its inside rather than emitting from its surface. */
const SHAPE_VOLUME = 0x1;

/**
 * The shape a newborn is placed by, off whichever class `SpawnShape` holds.
 *
 * A class outside the tree, and no shape at all, both spawn at the emitter's own origin.
 */
export function readShape(node: VfxValue | null): SpawnShape {
  if (node?.type !== "struct") return POINT_SHAPE;
  const volume = ((number(field(node, SHAPE.flags)) ?? 0) & SHAPE_VOLUME) !== 0;

  switch (node.classHash) {
    case SHAPE_CLASS.box:
      return { kind: "box", size: triple(field(node, SHAPE.size)), volume };
    case SHAPE_CLASS.cylinder:
      return {
        kind: "cylinder",
        radius: number(field(node, SHAPE.radius)) ?? 0,
        height: number(field(node, SHAPE.height)) ?? 0,
        volume,
      };
    case SHAPE_CLASS.sphere:
      return { kind: "sphere", radius: number(field(node, SHAPE.radius)) ?? 0, volume };
    case SHAPE_CLASS.legacy:
    case SHAPE_CLASS.old:
      return {
        kind: "legacy",
        offset: curve(field(node, SHAPE.emitOffset), DEFAULT.zero3),
        translation: curve(field(node, SHAPE.birthTranslation), DEFAULT.zero3),
        angles: curves(field(node, SHAPE.angles)),
        axes: triples(field(node, SHAPE.axes)),
      };
    case SHAPE_CLASS.point:
      return { kind: "point", offset: triple(field(node, SHAPE.emitOffset)) };
    default:
      return POINT_SHAPE;
  }
}

/** A `List<Vec3>` as its points, an item short of three channels dropped. */
function triples(node: VfxValue | null): Point[] {
  if (node?.type !== "container") return [];
  return node.items.flatMap((item) => {
    const held = components(item);
    return held !== null && held.length >= 3 ? [[held[0], held[1], held[2]] as Point] : [];
  });
}

/** `VfxTrailDefinitionData`'s own fields. */
const TRAIL = {
  mode: nameHash("mMode"),
  smoothing: nameHash("mSmoothingMode"),
  maxAdded: nameHash("mMaxAddedPerFrame"),
  tiling: nameHash("mBirthTilingSize"),
  cutoff: nameHash("mCutoff"),
} as const;

/** `VfxBeamDefinitionData`'s own fields. */
const BEAM = {
  mode: nameHash("mMode"),
  trailMode: nameHash("mTrailMode"),
  segments: nameHash("mSegments"),
  tiling: nameHash("mBirthTilingSize"),
  color: nameHash("mAnimatedColorWithDistance"),
  bound: nameHash("mIsColorBindedWithDistance"),
  source: nameHash("mLocalSpaceSourceOffset"),
  target: nameHash("mLocalSpaceTargetOffset"),
} as const;

/** The ribbon a trail primitive carries, and null for a primitive of any other kind. */
export function readTrail(primitive: VfxValue | null): TrailModel | null {
  const kind = quadType(primitive);
  if (kind !== QUAD_TYPE.cameraTrail && kind !== QUAD_TYPE.arbitraryTrail) return null;

  const held = field(primitive, PRIMITIVE_FIELD.trail);
  return {
    mode: enumByte(field(held, TRAIL.mode), TRAIL_MODE, TRAIL_MODE.default),
    smoothing: enumByte(field(held, TRAIL.smoothing), TRAIL_SMOOTHING, TRAIL_SMOOTHING.off),
    maxAddedPerFrame: number(field(held, TRAIL.maxAdded)) ?? 0,
    tiling: curve(field(held, TRAIL.tiling), DEFAULT.zero3),
    cutoff: number(field(held, TRAIL.cutoff)) ?? 0,
  };
}

/**
 * The ribbon a beam primitive carries, and null for a primitive of any other kind.
 *
 * `VfxPrimitiveCameraSegmentBeam` names no fields, so it reads as a beam at every default.
 */
export function readBeam(primitive: VfxValue | null): BeamModel | null {
  const kind = quadType(primitive);
  if (kind !== QUAD_TYPE.beam && kind !== QUAD_TYPE.cameraSegmentBeam) return null;

  const held = field(primitive, PRIMITIVE_FIELD.beam);
  return {
    mode: enumByte(field(held, BEAM.mode), BEAM_MODE, BEAM_MODE.default),
    trailMode: enumByte(field(held, BEAM.trailMode), TRAIL_MODE, TRAIL_MODE.default),
    segments: number(field(held, BEAM.segments)) ?? 0,
    tiling: curve(field(held, BEAM.tiling), DEFAULT.zero3),
    colorByDistance: curve(field(held, BEAM.color), DEFAULT.white),
    colorBoundToDistance: flag(field(held, BEAM.bound)),
    sourceOffset: triple(field(held, BEAM.source)),
    targetOffset: triple(field(held, BEAM.target)),
  };
}

/** `VfxLingerDefinitionData`'s pairs: the toggle, and the curve it switches in. */
const LINGER = {
  rotation: [nameHash("UseLingerRotation"), nameHash("LingerRotation")],
  scale: [nameHash("UseLingerScale"), nameHash("LingerScale")],
  color: [nameHash("UseSeparateLingerColor"), nameHash("SeparateLingerColor")],
  acceleration: [nameHash("UseKeyedLingerAcceleration"), nameHash("KeyedLingerAcceleration")],
  velocity: [nameHash("UseKeyedLingerVelocity"), nameHash("KeyedLingerVelocity")],
  drag: [nameHash("UseKeyedLingerDrag"), nameHash("KeyedLingerDrag")],
} as const;

/**
 * What a lingering particle reads in place of its emitter's curves, toggle by toggle.
 *
 * A toggle the block leaves off reads as null, so the integrator and the appearance pass
 * fall through to the emitter's own curve without consulting the flags again.
 */
export function readLinger(node: VfxValue | null): LingerModel | null {
  if (node?.type !== "struct") return null;
  const used = (pair: readonly [string, string], fallback: ValueCurve): ValueCurve | null =>
    flag(field(node, pair[0])) ? curve(field(node, pair[1]), fallback) : null;

  return {
    rotation: used(LINGER.rotation, DEFAULT.zero3),
    scale: used(LINGER.scale, DEFAULT.one3),
    color: used(LINGER.color, DEFAULT.white),
    acceleration: used(LINGER.acceleration, DEFAULT.zero3),
    velocity: used(LINGER.velocity, DEFAULT.zero3),
    drag: used(LINGER.drag, DEFAULT.zero3),
  };
}

/** `VfxEmitterLegacySimple`'s own fields. */
const LEGACY_SIMPLE = {
  birthScale: nameHash("birthScale"),
  scaleBias: nameHash("scaleBias"),
  scale: nameHash("scale"),
  birthRotation: nameHash("birthRotation"),
  birthRotationalVelocity: nameHash("birthRotationalVelocity"),
  rotation: nameHash("rotation"),
  lockedToEmitter: nameHash("lockedToEmitter"),
  hasFixedOrbit: nameHash("hasFixedOrbit"),
  fixedOrbitType: nameHash("fixedOrbitType"),
  orientation: nameHash("orientation"),
  particleBind: nameHash("particleBind"),
  uvScrollRate: nameHash("uvScrollRate"),
  scaleUpFromOrigin: nameHash("scaleUpFromOrigin"),
} as const;

/** The simple emitter's scalar block, and null for an emitter carrying none. */
export function readLegacySimple(node: VfxValue | null): LegacySimpleModel | null {
  if (node?.type !== "struct") return null;

  return {
    birthScale: curve(field(node, LEGACY_SIMPLE.birthScale), DEFAULT.one),
    scaleBias: pairOr(field(node, LEGACY_SIMPLE.scaleBias), [1, 1]),
    scale: curve(field(node, LEGACY_SIMPLE.scale), DEFAULT.one),
    birthRotation: curve(field(node, LEGACY_SIMPLE.birthRotation), DEFAULT.zero),
    birthRotationalVelocity: curve(
      field(node, LEGACY_SIMPLE.birthRotationalVelocity),
      DEFAULT.zero,
    ),
    rotation: curve(field(node, LEGACY_SIMPLE.rotation), DEFAULT.zero),
    lockedToEmitter: flag(field(node, LEGACY_SIMPLE.lockedToEmitter)),
    hasFixedOrbit: flag(field(node, LEGACY_SIMPLE.hasFixedOrbit)),
    fixedOrbitType: enumByte(
      field(node, LEGACY_SIMPLE.fixedOrbitType),
      FIXED_ORBIT,
      FIXED_ORBIT.worldY,
    ),
    orientation: simpleOrientation(field(node, LEGACY_SIMPLE.orientation)),
    particleBind: pair(field(node, LEGACY_SIMPLE.particleBind)),
    uvScrollRate: pair(field(node, LEGACY_SIMPLE.uvScrollRate)),
    scaleUpFromOrigin: flag(field(node, LEGACY_SIMPLE.scaleUpFromOrigin)),
  };
}

/** The plane the byte names, and the camera's for one outside the enum. */
function simpleOrientation(node: VfxValue | null): SimpleOrientation {
  return enumByte(node, SIMPLE_ORIENTATION, SIMPLE_ORIENTATION.camera);
}

/** `VfxFieldCollectionDefinitionData`'s five lists, in the order the engine runs them. */
const FIELD_LISTS = {
  acceleration: nameHash("fieldAccelerationDefinitions"),
  attraction: nameHash("fieldAttractionDefinitions"),
  noise: nameHash("fieldNoiseDefinitions"),
  drag: nameHash("fieldDragDefinitions"),
  orbital: nameHash("fieldOrbitalDefinitions"),
} as const;

/** The fields the five field classes write, each named once across the classes sharing it. */
const FIELD_KIND = {
  position: nameHash("Position"),
  acceleration: nameHash("acceleration"),
  radius: nameHash("radius"),
  strength: nameHash("strength"),
  axisFraction: nameHash("axisFraction"),
  frequency: nameHash("frequency"),
  velocityDelta: nameHash("velocityDelta"),
  direction: nameHash("direction"),
  localSpace: nameHash("isLocalSpace"),
} as const;

/** `VfxFieldOrbitalDefinitionData.direction`'s schema default, the world's up. */
const ORBITAL_AXIS = constant([0, 1, 0]);

/**
 * The fields an emitter's particles cross, and null for an emitter naming no collection
 * or one whose five lists hold nothing.
 */
export function readFields(node: VfxValue | null): FieldsModel | null {
  if (node?.type !== "struct") return null;
  const each = <T>(hash: string, read: (item: VfxValue) => T): T[] =>
    structs(field(node, hash)).map(read);

  const fields: FieldsModel = {
    acceleration: each(FIELD_LISTS.acceleration, (item) => ({
      acceleration: curve(field(item, FIELD_KIND.acceleration), DEFAULT.zero3),
      localSpace: flagOr(field(item, FIELD_KIND.localSpace), true),
    })),
    attraction: each(FIELD_LISTS.attraction, (item) => ({
      position: curve(field(item, FIELD_KIND.position), DEFAULT.zero3),
      acceleration: curve(field(item, FIELD_KIND.acceleration), DEFAULT.zero),
      radius: curve(field(item, FIELD_KIND.radius), DEFAULT.zero),
    })),
    noise: each(FIELD_LISTS.noise, (item) => ({
      position: curve(field(item, FIELD_KIND.position), DEFAULT.zero3),
      axisFraction: triple(field(item, FIELD_KIND.axisFraction)),
      frequency: curve(field(item, FIELD_KIND.frequency), DEFAULT.zero),
      radius: curve(field(item, FIELD_KIND.radius), DEFAULT.zero),
      velocityDelta: curve(field(item, FIELD_KIND.velocityDelta), DEFAULT.zero),
    })),
    drag: each(FIELD_LISTS.drag, (item) => ({
      position: curve(field(item, FIELD_KIND.position), DEFAULT.zero3),
      radius: curve(field(item, FIELD_KIND.radius), DEFAULT.zero),
      strength: curve(field(item, FIELD_KIND.strength), DEFAULT.zero),
    })),
    orbital: each(FIELD_LISTS.orbital, (item) => ({
      direction: curve(field(item, FIELD_KIND.direction), ORBITAL_AXIS),
      localSpace: flagOr(field(item, FIELD_KIND.localSpace), true),
    })),
  };

  return Object.values(fields).some((list) => list.length > 0) ? fields : null;
}

/** The structs a list holds, and none for a value that is not a list. */
function structs(node: VfxValue | null): VfxValue[] {
  if (node?.type !== "container") return [];
  return node.items.filter((item) => item.type === "struct");
}
