import type { VfxSystem, VfxValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import { COLOR_LOOKUP, DRAG_MOTION, STENCIL_MODE } from "./enums";
import type { ChildSetModel, EmitterModel, SystemModel, UvLayer } from "./model";
import {
  readBeam,
  readFields,
  readLegacySimple,
  readLinger,
  readShape,
  readTrail,
} from "./readMotion";
import {
  LAYER,
  MULT_TEXTURE,
  readDistortion,
  readErosion,
  readLayer,
  readMesh,
  readPalette,
  readReflection,
  readSoft,
} from "./readSurface";
import {
  ALPHA_REF_SCALE,
  blendMode,
  curve,
  DEFAULT,
  DEFAULT_ALPHA_REF,
  enumByte,
  field,
  flag,
  flagOr,
  lingerType,
  matrix,
  namedAsset,
  number,
  pair,
  pairOr,
  quadType,
  stencilMode,
  text,
  texts,
  triple,
  tripleOr,
  uvMode,
} from "./readValue";
import { emptySystem } from "./systemModel";

/** The system's own fields. */
const SYSTEM = { transform: nameHash("transform"), flags: nameHash("flags") } as const;

/** `flags`' schema default, which leaves `kAnalyticDragMotion` off. */
const FLAGS_DEFAULT = 0xd4;

/** `kAnalyticDragMotion` in `flags`. */
const ANALYTIC_DRAG_MOTION = 0x100;

/** The two lists a system holds its emitters in, in the order the strip reads them. */
const EMITTER_LISTS = [
  { hash: nameHash("complexEmitterDefinitionData"), simple: false },
  { hash: nameHash("simpleEmitterDefinitionData"), simple: true },
] as const;

/** The emitter fields the renderer reads, tier by tier of docs/plans/vfx-particle-renderer.md. */
const FIELD = {
  name: nameHash("emitterName"),
  disabled: nameHash("disabled"),
  rate: nameHash("rate"),
  particleLifetime: nameHash("particleLifetime"),
  lifetime: nameHash("lifetime"),
  timeBeforeFirstEmission: nameHash("timeBeforeFirstEmission"),
  singleParticle: nameHash("isSingleParticle"),
  sharedRandom: nameHash("ParticlesShareRandomValue"),
  birthVelocity: nameHash("birthVelocity"),
  acceleration: nameHash("acceleration"),
  drag: nameHash("drag"),
  birthDrag: nameHash("birthDrag"),
  velocity: nameHash("velocity"),
  worldAcceleration: nameHash("worldAcceleration"),
  bindWeight: nameHash("bindWeight"),
  particleLinger: nameHash("particleLinger"),
  lingerType: nameHash("particleLingerType"),
  linger: nameHash("Linger"),
  palette: nameHash("paletteDefinition"),
  erosion: nameHash("alphaErosionDefinition"),
  distortion: nameHash("distortionDefinition"),
  reflection: nameHash("reflectionDefinition"),
  soft: nameHash("softParticleParams"),
  lookupX: nameHash("colorLookUpTypeX"),
  lookupY: nameHash("colorLookUpTypeY"),
  lookupOffsets: nameHash("colorLookUpOffsets"),
  lookupScales: nameHash("colorLookUpScales"),
  colorTexture: nameHash("particleColorTexture"),
  emitterPosition: nameHash("EmitterPosition"),
  emitterSpace: nameHash("IsEmitterSpace"),
  spawnShape: nameHash("SpawnShape"),
  rotationOverride: nameHash("rotationOverride"),
  scaleOverride: nameHash("scaleOverride"),
  translationOverride: nameHash("translationOverride"),
  localOrientation: nameHash("isLocalOrientation"),
  particleLocalOrientation: nameHash("particleIsLocalOrientation"),
  uniformScale: nameHash("isUniformScale"),
  rotation0: nameHash("rotation0"),
  birthOrbitalVelocity: nameHash("birthOrbitalVelocity"),
  birthRotation0: nameHash("birthRotation0"),
  birthRotationalVelocity0: nameHash("birthRotationalVelocity0"),
  birthRotationalAcceleration: nameHash("birthRotationalAcceleration"),
  rotationEnabled: nameHash("isRotationEnabled"),
  directionOriented: nameHash("isDirectionOriented"),
  scale0: nameHash("scale0"),
  birthScale0: nameHash("birthScale0"),
  color: nameHash("Color"),
  birthColor: nameHash("birthColor"),
  texture: nameHash("texture"),
  blendMode: nameHash("blendMode"),
  primitive: nameHash("primitive"),
  depthBias: nameHash("depthBiasFactors"),
  depthPushPull: nameHash("DepthPushPull"),
  disableBackfaceCull: nameHash("disableBackfaceCull"),
  uvMode: nameHash("uvMode"),
  textureMult: nameHash("textureMult"),
  pass: nameHash("pass"),
  miscRenderFlags: nameHash("miscRenderFlags"),
  groundLayer: nameHash("isGroundLayer"),
  alphaRef: nameHash("alphaRef"),
  stencilMode: nameHash("stencilMode"),
  stencilRef: nameHash("stencilRef"),
  legacySimple: nameHash("LegacySimple"),
  childSet: nameHash("childParticleSetDefinition"),
  fields: nameHash("fieldCollectionDefinition"),
} as const;

/** `VfxChildParticleSetDefinitionData`'s own fields. */
const CHILD_SET = {
  children: nameHash("childrenIdentifiers"),
  bones: nameHash("boneToSpawnAt"),
  probability: nameHash("childrenProbability"),
  onDeath: nameHash("childEmitOnDeath"),
  inheritance: nameHash("ParentInheritanceDefinition"),
} as const;

/**
 * `VfxChildIdentifier.effect` then `effectKey`, which the resolver inlines where this
 * document holds the system, the link directly and the key through its `ResourceResolver`.
 *
 * The order reads a definition first and a key after.
 */
const CHILD_NAMES = [nameHash("effect"), nameHash("effectKey")] as const;

/** `VfxParentInheritanceParams`'s own fields. */
const INHERITANCE = { mode: nameHash("Mode"), offset: nameHash("RelativeOffset") } as const;

/**
 * One system's emitters, out of the tree `read_vfx_system` resolved.
 *
 * Decision 2.1 of docs/plans/vfx-particle-renderer.md puts the mapping here, on the same
 * `nameHash` the editor's rows are keyed on. A field the object does not write takes the
 * schema's default rather than dropping the emitter.
 */
export function readVfxSystem(system: VfxSystem): SystemModel {
  return readSystem(system.root, system.entry, system.name);
}

/** One `VfxSystemDefinitionData` struct, which is a read's root or a child set inlined. */
function readSystem(root: VfxValue, entry: string | null, name: string | null): SystemModel {
  if (root.type !== "struct") return emptySystem(entry);

  const emitters: EmitterModel[] = [];
  for (const list of EMITTER_LISTS) {
    const held = field(root, list.hash);
    if (held?.type !== "container") continue;
    /* The strip keys a card on its place in its own list, so the two indices are kept
       apart: one addresses the pool, and one joins a card to the emitter it drew. */
    held.items.forEach((item, listIndex) => {
      if (item.type !== "struct") return;
      emitters.push(readEmitter(item, emitters.length, list.simple, listIndex));
    });
  }

  const flags = number(field(root, SYSTEM.flags)) ?? FLAGS_DEFAULT;
  return {
    entry,
    name,
    emitters,
    transform: matrix(field(root, SYSTEM.transform)),
    dragMotion: (flags & ANALYTIC_DRAG_MOTION) !== 0 ? DRAG_MOTION.analytic : DRAG_MOTION.stepped,
  };
}

function readEmitter(
  node: VfxValue & { type: "struct" },
  index: number,
  simple: boolean,
  listIndex: number,
): EmitterModel {
  const primitive = field(node, FIELD.primitive);
  const texture = field(node, FIELD.texture);
  const colorTexture = field(node, FIELD.colorTexture);
  const read = readLayer(node, LAYER.base, null);
  const mult = field(node, FIELD.textureMult);
  const multTexture = mult?.type === "struct" ? field(mult, MULT_TEXTURE) : null;
  const legacySimple = readLegacySimple(field(node, FIELD.legacySimple));
  const stencil = stencilMode(field(node, FIELD.stencilMode));

  /* What the legacy block says about the whole emitter lowers onto the fields it
     stands in for, so the integrator reads one place for either kind of emitter. */
  const scrolls =
    legacySimple !== null &&
    (legacySimple.uvScrollRate[0] !== 0 || legacySimple.uvScrollRate[1] !== 0);
  const uv: UvLayer = scrolls ? { ...read, emitterScrollRate: legacySimple.uvScrollRate } : read;
  const locked = legacySimple?.lockedToEmitter === true;

  return {
    index,
    simple,
    listIndex,
    name: text(field(node, FIELD.name)) ?? "",
    disabled: flag(field(node, FIELD.disabled)),

    rate: curve(field(node, FIELD.rate), DEFAULT.rate),
    particleLifetime: curve(field(node, FIELD.particleLifetime), DEFAULT.particleLifetime),
    lifetime: number(field(node, FIELD.lifetime)),
    timeBeforeFirstEmission: number(field(node, FIELD.timeBeforeFirstEmission)) ?? 0,
    singleParticle: flag(field(node, FIELD.singleParticle)),
    sharedRandom: flag(field(node, FIELD.sharedRandom)),

    birthVelocity: curve(field(node, FIELD.birthVelocity), DEFAULT.zero3),
    acceleration: curve(field(node, FIELD.acceleration), DEFAULT.zero3),
    drag: curve(field(node, FIELD.drag), DEFAULT.zero3),
    birthDrag: curve(field(node, FIELD.birthDrag), DEFAULT.zero3),
    velocity: curve(field(node, FIELD.velocity), DEFAULT.zero3),
    worldAcceleration: curve(field(node, FIELD.worldAcceleration), DEFAULT.zero3),
    bindWeight: locked ? DEFAULT.one : curve(field(node, FIELD.bindWeight), DEFAULT.zero),
    emitterPosition: curve(field(node, FIELD.emitterPosition), DEFAULT.zero3),
    emitterSpace: locked || flag(field(node, FIELD.emitterSpace)),
    shape: readShape(field(node, FIELD.spawnShape)),
    rotationOverride: triple(field(node, FIELD.rotationOverride)),
    scaleOverride: tripleOr(field(node, FIELD.scaleOverride), [1, 1, 1]),
    translationOverride: triple(field(node, FIELD.translationOverride)),
    localOrientation: flagOr(field(node, FIELD.localOrientation), true),
    particleLocalOrientation: flag(field(node, FIELD.particleLocalOrientation)),
    uniformScale: flag(field(node, FIELD.uniformScale)),

    particleLinger: number(field(node, FIELD.particleLinger)) ?? 0,
    lingerType: lingerType(field(node, FIELD.lingerType)),
    linger: readLinger(field(node, FIELD.linger)),

    palette: readPalette(field(node, FIELD.palette)),
    erosion: readErosion(field(node, FIELD.erosion)),
    distortion: readDistortion(field(node, FIELD.distortion)),
    reflection: readReflection(field(node, FIELD.reflection)),
    soft: readSoft(field(node, FIELD.soft)),
    lookupX: enumByte(field(node, FIELD.lookupX), COLOR_LOOKUP, COLOR_LOOKUP.lifetime),
    lookupY: enumByte(field(node, FIELD.lookupY), COLOR_LOOKUP, COLOR_LOOKUP.constant),
    lookupOffsets: pairOr(field(node, FIELD.lookupOffsets), [0, 0]),
    lookupScales: pairOr(field(node, FIELD.lookupScales), [1, 1]),
    colorTexture: namedAsset(colorTexture),

    rotation0: curve(field(node, FIELD.rotation0), DEFAULT.zero3),
    birthOrbitalVelocity: curve(field(node, FIELD.birthOrbitalVelocity), DEFAULT.zero3),
    birthRotation0: curve(field(node, FIELD.birthRotation0), DEFAULT.zero3),
    birthRotationalVelocity0: curve(field(node, FIELD.birthRotationalVelocity0), DEFAULT.zero3),
    birthRotationalAcceleration: curve(
      field(node, FIELD.birthRotationalAcceleration),
      DEFAULT.zero3,
    ),
    legacySimple,
    pivotUp: legacySimple?.scaleUpFromOrigin === true,
    rotationEnabled: flag(field(node, FIELD.rotationEnabled)),
    directionOriented: flag(field(node, FIELD.directionOriented)),

    scale0: curve(field(node, FIELD.scale0), DEFAULT.one3),
    birthScale0: curve(field(node, FIELD.birthScale0), DEFAULT.one3),
    color: curve(field(node, FIELD.color), DEFAULT.white),
    birthColor: curve(field(node, FIELD.birthColor), DEFAULT.white),

    texture: namedAsset(texture),
    uv,
    uvMode: uvMode(field(node, FIELD.uvMode)),
    multTexture: namedAsset(multTexture),
    multUv: mult?.type === "struct" ? readLayer(mult, LAYER.mult, uv.book) : null,
    blendMode: blendMode(field(node, FIELD.blendMode)),
    pass: number(field(node, FIELD.pass)) ?? 0,
    miscRenderFlags: number(field(node, FIELD.miscRenderFlags)) ?? 0,
    groundLayer: flag(field(node, FIELD.groundLayer)),
    alphaRef: (number(field(node, FIELD.alphaRef)) ?? DEFAULT_ALPHA_REF) / ALPHA_REF_SCALE,
    stencilMode: stencil,
    /* Read off a mode alone. */
    stencilRef:
      stencil === STENCIL_MODE.disabled ? 0 : (number(field(node, FIELD.stencilRef)) ?? 0),
    quadType: quadType(primitive),
    primitiveClass: primitive?.type === "struct" ? primitive.classHash : null,
    primitiveName: primitive?.type === "struct" ? primitive.class : null,
    mesh: readMesh(primitive),
    trail: readTrail(primitive),
    beam: readBeam(primitive),
    childSet: readChildSet(field(node, FIELD.childSet)),
    fields: readFields(field(node, FIELD.fields)),

    depthBias: pair(field(node, FIELD.depthBias)),
    depthPushPull: number(field(node, FIELD.depthPushPull)) ?? 0,
    backfaceCull: !flag(field(node, FIELD.disableBackfaceCull)),
  };
}

/**
 * The systems a particle spawns, and null for an emitter naming no child set.
 *
 * A child the resolver could not reach reads as no system rather than dropping out, which
 * keeps its place so `childrenProbability` still indexes the list as authored.
 */
function readChildSet(node: VfxValue | null): ChildSetModel | null {
  if (node?.type !== "struct") return null;
  const listed = field(node, CHILD_SET.children);
  const inheritance = field(node, CHILD_SET.inheritance);

  return {
    children: listed?.type === "container" ? listed.items.map(readChild) : [],
    bones: texts(field(node, CHILD_SET.bones)),
    probability: curve(field(node, CHILD_SET.probability), DEFAULT.zero),
    onDeath: flag(field(node, CHILD_SET.onDeath)),
    inheritance:
      inheritance?.type === "struct"
        ? {
            mode: number(field(inheritance, INHERITANCE.mode)) ?? 0,
            offset: curve(field(inheritance, INHERITANCE.offset), DEFAULT.zero3),
          }
        : null,
  };
}

/** The system one `VfxChildIdentifier` names, where the resolver inlined it. */
function readChild(identifier: VfxValue): SystemModel | null {
  for (const hash of CHILD_NAMES) {
    const held = field(identifier, hash);
    if (held?.type === "struct") {
      return readSystem(held, held.object?.entry ?? null, held.object?.name ?? null);
    }
  }
  return null;
}
