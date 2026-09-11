import type { VfxValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import { ADDRESS_MODE, type AddressMode } from "./enums";
import type {
  DistortionModel,
  ErosionModel,
  Flipbook,
  MeshModel,
  PaletteModel,
  ReflectionModel,
  SoftModel,
  UvLayer,
} from "./model";
import {
  channelsOr,
  curve,
  DEFAULT,
  enumByte,
  field,
  flag,
  hashes,
  located,
  named,
  namedAsset,
  number,
  pair,
  pairOr,
  type Placed,
} from "./readValue";

/**
 * One texture layer's fields, by the name each of the two layers spells them.
 *
 * `textureMult` names its own copy of every field with a `Mult` suffix, except the two
 * it spells `TextureMultFilpU` and `TextureMultFilpV` — Riot's own typo, and the name a
 * bin writes.
 */
export const LAYER = {
  base: {
    texDiv: nameHash("texDiv"),
    numFrames: nameHash("numFrames"),
    startFrame: nameHash("startFrame"),
    frameRate: nameHash("frameRate"),
    birthFrameRate: nameHash("birthFrameRate"),
    randomStart: nameHash("isRandomStartFrame"),
    scale: nameHash("uvScale"),
    rotation: nameHash("uvRotation"),
    birthOffset: nameHash("birthUVOffset"),
    birthScrollRate: nameHash("birthUvScrollRate"),
    birthRotateRate: nameHash("birthUvRotateRate"),
    scrollRate: nameHash("particleUVScrollRate"),
    rotateRate: nameHash("particleUVRotateRate"),
    emitterScrollRate: nameHash("emitterUvScrollRate"),
    center: nameHash("uvTransformCenter"),
    flipU: nameHash("TextureFlipU"),
    flipV: nameHash("TextureFlipV"),
    scrollClamp: nameHash("uvScrollClamp"),
    addressMode: nameHash("texAddressModeBase"),
  },
  mult: {
    texDiv: nameHash("texDivMult"),
    /* One frame counter serves both layers, so a book is the base layer's and only the
       grid differs. `isRandomStartFrameMult` is written by the loader and read by
       nothing. */
    numFrames: null,
    startFrame: null,
    frameRate: null,
    birthFrameRate: null,
    randomStart: null,
    scale: nameHash("uvScaleMult"),
    rotation: nameHash("UvRotationMult"),
    birthOffset: nameHash("birthUVOffsetMult"),
    birthScrollRate: nameHash("birthUvScrollRateMult"),
    birthRotateRate: nameHash("birthUvRotateRateMult"),
    scrollRate: nameHash("ParticleIntegratedUvScrollMult"),
    rotateRate: nameHash("ParticleIntegratedUvRotateMult"),
    emitterScrollRate: nameHash("emitterUvScrollRateMult"),
    center: nameHash("uvTransformCenterMult"),
    flipU: nameHash("TextureMultFilpU"),
    flipV: nameHash("TextureMultFilpV"),
    scrollClamp: nameHash("uvScrollClampMult"),
    addressMode: nameHash("texAddressModeMult"),
  },
} as const;

/** What `textureMult` names its own texture, which is the same hash the pointer takes. */
export const MULT_TEXTURE = nameHash("textureMult");

/** `uvTransformCenter`'s own default, which is the middle of the cell. */
const CENTER: readonly [number, number] = [0.5, 0.5];

/**
 * The fields of `primitive` the mesh reader opens, which are the primitive's own rather
 * than the emitter's.
 */
const PRIMITIVE_FIELD = {
  mesh: nameHash("mMesh"),
  alignPitch: nameHash("AlignPitchToCamera"),
  alignYaw: nameHash("AlignYawToCamera"),
} as const;

/**
 * `VfxMeshDefinitionData`'s own fields.
 *
 * `mMeshName` with `mMeshSkeletonName` is the `.skn` and `.skl` pair, and
 * `mSimpleMeshName` is the slot the engine reads only where the pair is not whole.
 */
const MESH = {
  skinned: nameHash("mMeshName"),
  skeleton: nameHash("mMeshSkeletonName"),
  simple: nameHash("mSimpleMeshName"),
  submeshes: nameHash("mSubmeshesToDraw"),
  submeshesAlways: nameHash("mSubmeshesToDrawAlways"),
} as const;

/** The file name the engine takes as a mesh slot left empty, whatever its extension. */
const NO_MESH = "doesnotexist.";

/** The extensions `mSimpleMeshName` is read under, and under any other it is ignored. */
const SIMPLE_MESH_EXTENSIONS = [".scb", ".tmesh", ".gmesh"] as const;

/** `VfxPaletteDefinitionData`'s own fields, `palleteSrcMixColor` spelled as the bin does. */
const PALETTE = {
  texture: nameHash("paletteTexture"),
  count: nameHash("paletteCount"),
  selector: nameHash("paletteSelector"),
  scrollU: nameHash("PaletteUAnimationCurve"),
  scrollV: nameHash("PaletteVAnimationCurve"),
  mix: nameHash("palleteSrcMixColor"),
  addressMode: nameHash("PaletteTextureAddressMode"),
} as const;

/** `VfxAlphaErosionDefinitionData`'s own fields. */
const EROSION = {
  map: nameHash("erosionMapName"),
  addressMode: nameHash("erosionMapAddressMode"),
  mixer: nameHash("erosionMapChannelMixer"),
  drive: nameHash("erosionDriveCurve"),
  useLingerDrive: nameHash("UseLingerErosionDriveCurve"),
  lingerDrive: nameHash("LingerErosionDriveCurve"),
  driveSource: nameHash("erosionDriveSource"),
  featherIn: nameHash("erosionFeatherIn"),
  featherOut: nameHash("erosionFeatherOut"),
  sliceWidth: nameHash("erosionSliceWidth"),
} as const;

/** `erosionFeatherIn` and `erosionFeatherOut`'s own default, and `erosionSliceWidth`'s. */
const EROSION_DEFAULT = { feather: 0.1, sliceWidth: 1.5, addressMode: 2 } as const;

/**
 * What the sampler makes of the erosion map's authored address byte, by that byte.
 *
 * The byte is written in the particle enum and copied to the sampler unremapped, and the
 * sampler's own enum swaps mirror and clamp. So an authored clamp, the default, samples
 * as a mirror and an authored mirror as a clamp.
 */
const EROSION_SAMPLER_ADDRESS: readonly AddressMode[] = [
  ADDRESS_MODE.wrap,
  ADDRESS_MODE.clamp,
  ADDRESS_MODE.mirror,
  ADDRESS_MODE.border,
];

/** What `VfxDistortionDefinitionData` names its three fields. */
const DISTORTION = {
  strength: nameHash("distortion"),
  mode: nameHash("distortionMode"),
  map: nameHash("normalMapTexture"),
} as const;

/** `distortionMode`'s own default, which most of the shipped blocks leave it at. */
const DISTORTION_MODE_DEFAULT = 1;

/** `VfxReflectionDefinitionData`'s own fields. */
const REFLECTION = {
  fresnel: nameHash("fresnel"),
  fresnelColor: nameHash("fresnelColor"),
  reflectionFresnel: nameHash("reflectionFresnel"),
  reflectionFresnelColor: nameHash("reflectionFresnelColor"),
  map: nameHash("reflectionMapTexture"),
  opacityDirect: nameHash("reflectionOpacityDirect"),
  opacityGlancing: nameHash("reflectionOpacityGlancing"),
} as const;

/** `VfxSoftParticleDefinitionData`'s four named fields. */
const SOFT = {
  beginIn: nameHash("beginIn"),
  deltaIn: nameHash("deltaIn"),
  beginOut: nameHash("beginOut"),
  deltaOut: nameHash("deltaOut"),
} as const;

/**
 * The geometry a mesh primitive draws, and null where nothing on this machine holds it.
 *
 * The skinned pair wins outright where it is whole, and the simple slot is read only
 * then. A slot whose path the backend could not place answers no mesh rather than an
 * unloadable one.
 */
export function readMesh(primitive: VfxValue | null): MeshModel | null {
  const held = field(primitive, PRIMITIVE_FIELD.mesh);
  if (held?.type !== "struct") return null;

  const skinned = skinnedMesh(held);
  const named = skinned ?? simpleMesh(held);
  if (named === null) return null;

  return {
    asset: named.asset,
    path: named.path,
    skinned: skinned !== null,
    submeshes: hashes(field(held, MESH.submeshes)),
    submeshesAlways: hashes(field(held, MESH.submeshesAlways)),
    alignPitch: flag(field(primitive, PRIMITIVE_FIELD.alignPitch)),
    alignYaw: flag(field(primitive, PRIMITIVE_FIELD.alignYaw)),
  };
}

/**
 * The `.skn` of a whole pair: both names written and neither the empty-slot sentinel.
 *
 * The skeleton is not loaded here, so its name is tested and not placed.
 */
function skinnedMesh(mesh: VfxValue): Placed | null {
  const skin = located(field(mesh, MESH.skinned));
  const skeleton = named(field(mesh, MESH.skeleton));
  if (skin === null || skeleton === null || isNoMesh(skin.path) || isNoMesh(skeleton)) {
    return null;
  }
  return skin;
}

/** The simple mesh, where its name ends in an extension the engine reads. */
function simpleMesh(mesh: VfxValue): Placed | null {
  const simple = located(field(mesh, MESH.simple));
  if (simple === null || isNoMesh(simple.path)) return null;
  const path = simple.path.toLowerCase();
  return SIMPLE_MESH_EXTENSIONS.some((extension) => path.endsWith(extension)) ? simple : null;
}

function isNoMesh(path: string): boolean {
  return path.toLowerCase().split("/").at(-1)?.startsWith(NO_MESH) ?? false;
}

/** The palette an emitter reads its colour off, and null for one carrying none. */
export function readPalette(node: VfxValue | null): PaletteModel | null {
  if (node?.type !== "struct") return null;

  return {
    texture: namedAsset(field(node, PALETTE.texture)),
    count: number(field(node, PALETTE.count)) ?? 1,
    selector: curve(field(node, PALETTE.selector), DEFAULT.zero3),
    scrollU: curve(field(node, PALETTE.scrollU), DEFAULT.zero),
    scrollV: curve(field(node, PALETTE.scrollV), DEFAULT.zero),
    mix: curve(field(node, PALETTE.mix), DEFAULT.luma),
    addressMode: enumByte(field(node, PALETTE.addressMode), ADDRESS_MODE, ADDRESS_MODE.mirror),
  };
}

/** The erosion an emitter cuts its alpha by, and null for one carrying none. */
export function readErosion(node: VfxValue | null): ErosionModel | null {
  if (node?.type !== "struct") return null;

  return {
    map: namedAsset(field(node, EROSION.map)),
    addressMode: erosionAddressMode(field(node, EROSION.addressMode)),
    mixer: curve(field(node, EROSION.mixer), DEFAULT.alpha),
    drive: curve(field(node, EROSION.drive), DEFAULT.one),
    lingerDrive: flag(field(node, EROSION.useLingerDrive))
      ? curve(field(node, EROSION.lingerDrive), DEFAULT.one)
      : null,
    driveSource: number(field(node, EROSION.driveSource)) ?? 0,
    featherIn: number(field(node, EROSION.featherIn)) ?? EROSION_DEFAULT.feather,
    featherOut: number(field(node, EROSION.featherOut)) ?? EROSION_DEFAULT.feather,
    sliceWidth: number(field(node, EROSION.sliceWidth)) ?? EROSION_DEFAULT.sliceWidth,
  };
}

/** The erosion map's address mode as the sampler receives it, off the authored byte. */
function erosionAddressMode(node: VfxValue | null): AddressMode {
  const held = number(node);
  const authored =
    held !== null && Number.isInteger(held) && held >= 0 && held < EROSION_SAMPLER_ADDRESS.length
      ? held
      : EROSION_DEFAULT.addressMode;
  return EROSION_SAMPLER_ADDRESS[authored];
}

/** The warp an emitter draws in place of its colour, and null for one drawing colour. */
export function readDistortion(node: VfxValue | null): DistortionModel | null {
  if (node?.type !== "struct") return null;

  return {
    strength: number(field(node, DISTORTION.strength)) ?? 0,
    mode: number(field(node, DISTORTION.mode)) ?? DISTORTION_MODE_DEFAULT,
    map: namedAsset(field(node, DISTORTION.map)),
  };
}

/** The rim and the reflection a mesh draws, and null for an emitter carrying neither. */
export function readReflection(node: VfxValue | null): ReflectionModel | null {
  if (node?.type !== "struct") return null;

  return {
    fresnel: number(field(node, REFLECTION.fresnel)) ?? 1,
    fresnelColor: channelsOr(field(node, REFLECTION.fresnelColor), [0, 0, 0, 0]),
    reflectionFresnel: number(field(node, REFLECTION.reflectionFresnel)) ?? 1,
    reflectionFresnelColor: channelsOr(
      field(node, REFLECTION.reflectionFresnelColor),
      [1, 1, 1, 1],
    ),
    opacityDirect: number(field(node, REFLECTION.opacityDirect)) ?? 0,
    opacityGlancing: number(field(node, REFLECTION.opacityGlancing)) ?? 1,
    map: namedAsset(field(node, REFLECTION.map)),
  };
}

/** The fade an emitter runs against the scene behind it, and null for one carrying none. */
export function readSoft(node: VfxValue | null): SoftModel | null {
  if (node?.type !== "struct") return null;

  return {
    beginIn: number(field(node, SOFT.beginIn)) ?? 0,
    deltaIn: number(field(node, SOFT.deltaIn)) ?? 0,
    beginOut: number(field(node, SOFT.beginOut)) ?? 0,
    deltaOut: number(field(node, SOFT.deltaOut)) ?? 0,
  };
}

/** The field names one layer spells its own copy of every UV field by. */
type LayerNames = (typeof LAYER)["base"] | (typeof LAYER)["mult"];

/**
 * One texture layer, out of whichever of the two sets of names carries it.
 *
 * A field the mult layer has no name for takes the base layer's own value, which is what
 * makes one frame counter drive both samplers.
 */
export function readLayer(node: VfxValue, names: LayerNames, shared: Flipbook | null): UvLayer {
  const held = (hash: string | null) => (hash === null ? null : field(node, hash));

  return {
    book: {
      divisions: pairOr(field(node, names.texDiv), [1, 1]),
      frames: shared?.frames ?? number(held(names.numFrames)) ?? 1,
      start: shared?.start ?? number(held(names.startFrame)) ?? 0,
      rate: shared?.rate ?? number(held(names.frameRate)) ?? 0,
      birthRate: curve(held(names.birthFrameRate), shared?.birthRate ?? DEFAULT.one),
      randomStart: shared?.randomStart ?? flag(held(names.randomStart)),
    },
    scale: curve(field(node, names.scale), DEFAULT.one2),
    rotation: curve(field(node, names.rotation), DEFAULT.zero),
    birthOffset: curve(field(node, names.birthOffset), DEFAULT.zero2),
    birthScrollRate: curve(field(node, names.birthScrollRate), DEFAULT.zero2),
    birthRotateRate: curve(field(node, names.birthRotateRate), DEFAULT.zero),
    scrollRate: curve(field(node, names.scrollRate), DEFAULT.zero2),
    rotateRate: curve(field(node, names.rotateRate), DEFAULT.zero),
    emitterScrollRate: pair(field(node, names.emitterScrollRate)),
    center: pairOr(field(node, names.center), CENTER),
    flipU: flag(field(node, names.flipU)),
    flipV: flag(field(node, names.flipV)),
    scrollClamp: flag(field(node, names.scrollClamp)),
    addressMode: enumByte(field(node, names.addressMode), ADDRESS_MODE, ADDRESS_MODE.wrap),
  };
}
