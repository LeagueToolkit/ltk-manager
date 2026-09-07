import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { fieldHash } from "./binRows";

/** One component group of an emitter, in the order a card lists them. */
export type EmitterGroup =
  | "emission"
  | "birth"
  | "position"
  | "scale"
  | "colour"
  | "texture"
  | "render"
  | "material"
  | "effects"
  | "other";

/**
 * The fields of each group, by the name the emitter declares them under.
 *
 * "The emitter strip" in docs/ux/BIN_EDITOR.md.
 */
export const GROUP_FIELDS: Record<Exclude<EmitterGroup, "other">, readonly string[]> = {
  emission: [
    "rate",
    "flexRate",
    "period",
    "lifetime",
    "particleLifetime",
    "flexParticleLifetime",
    "timeBeforeFirstEmission",
    "timeActiveDuringPeriod",
    "Linger",
    "emitterLinger",
    "particleLinger",
    "particleLingerType",
    "isSingleParticle",
    "ChanceToNotExist",
    "MaximumRateByVelocity",
    "rateByVelocityFunction",
    "ParticlesShareRandomValue",
    "HasVariableStartTime",
    "importance",
  ],
  birth: [
    "birthColor",
    "birthScale0",
    "birthVelocity",
    "flexBirthVelocity",
    "birthAcceleration",
    "birthOrbitalVelocity",
    "birthDrag",
    "birthRotation0",
    "birthRotationalVelocity0",
    "flexBirthRotationalVelocity0",
    "birthRotationalAcceleration",
    "birthFrameRate",
    "birthUVOffset",
    "flexBirthUVOffset",
    "birthUvRotateRate",
    "birthUvScrollRate",
    "flexBirthUVScrollRate",
    "flexScaleBirthScale",
  ],
  position: [
    "EmitterPosition",
    "SpawnShape",
    "FlexShapeDefinition",
    "shape",
    "IsEmitterSpace",
    "isFollowingTerrain",
    "isGroundLayer",
    "useNavmeshMask",
    "bindWeight",
    "velocity",
    "acceleration",
    "worldAcceleration",
    "drag",
    "directionVelocityScale",
    "directionVelocityMinScale",
    "translationOverride",
    "flexOffset",
    "offsetLifetimeScaling",
    "offsetLifeScalingSymmetryMode",
    "rotation0",
    "rotationOverride",
    "isRotationEnabled",
    "hasPostRotateOrientation",
    "postRotateOrientationAxis",
    "isDirectionOriented",
    "isLocalOrientation",
    "particleIsLocalOrientation",
    "emissionMeshName",
    "emissionMeshScale",
    "emissionSurfaceDefinition",
    "useEmissionMeshNormalForBirth",
  ],
  scale: [
    "scale0",
    "scaleOverride",
    "isUniformScale",
    "FlexInstanceScale",
    "doesLifetimeScale",
    "doesParticleLifetimeScale",
  ],
  colour: [
    "Color",
    "modulationFactor",
    "censorModulateValue",
    "colorblindVisibility",
    "colorRenderFlags",
    "colorLookUpTypeX",
    "colorLookUpTypeY",
    "colorLookUpOffsets",
    "colorLookUpScales",
    "paletteDefinition",
    "particleColorTexture",
  ],
  texture: [
    "texture",
    "textureMult",
    "falloffTexture",
    "isTexturePixelated",
    "texAddressModeBase",
    "texDiv",
    "TextureFlipU",
    "TextureFlipV",
    "Filtering",
    "numFrames",
    "frameRate",
    "startFrame",
    "isRandomStartFrame",
    "uvMode",
    "uvScale",
    "uvRotation",
    "uvScrollClamp",
    "uvTransformCenter",
    "uvParallaxScale",
    "particleUVRotateRate",
    "particleUVScrollRate",
    "emitterUvScrollRate",
  ],
  render: [
    "blendMode",
    "primitive",
    "pass",
    "renderPhaseOverride",
    "alphaRef",
    "WriteAlphaOnly",
    "disableBackfaceCull",
    "doesCastShadow",
    "depthBiasFactors",
    "DepthPushPull",
    "softParticleParams",
    "sliceTechniqueRange",
    "stencilMode",
    "stencilRef",
    "StencilReferenceId",
    "miscRenderFlags",
    "meshRenderFlags",
    "SortEmittersByPos",
    "LegacySimple",
  ],
  material: ["Material", "CustomMaterial", "materialOverrideDefinitions", "materialDrivers"],
  effects: [
    "Audio",
    "alphaErosionDefinition",
    "distortionDefinition",
    "reflectionDefinition",
    "childParticleSetDefinition",
    "fieldCollectionDefinition",
  ],
};

/** The word a chip and the panel's heading carry. */
export const GROUP_TITLE: Record<EmitterGroup, () => string> = {
  emission: m.workshop_bin_emitter_group_emission_label,
  birth: m.workshop_bin_emitter_group_birth_label,
  position: m.workshop_bin_emitter_group_position_label,
  scale: m.workshop_bin_emitter_group_scale_label,
  colour: m.workshop_bin_emitter_group_colour_label,
  texture: m.workshop_bin_emitter_group_texture_label,
  render: m.workshop_bin_emitter_group_render_label,
  material: m.workshop_bin_emitter_group_material_label,
  effects: m.workshop_bin_emitter_group_effects_label,
  other: m.workshop_bin_section_other_label,
};

/** Every group in the order a card lists them, Other last. */
export const GROUP_ORDER: readonly EmitterGroup[] = [
  "emission",
  "birth",
  "position",
  "scale",
  "colour",
  "texture",
  "render",
  "material",
  "effects",
  "other",
];

/** The fields the card draws itself, which no group repeats. */
export const CARD = {
  name: nameHash("emitterName"),
  disabled: nameHash("disabled"),
  texture: nameHash("texture"),
  colour: nameHash("birthColor"),
} as const;

const BY_FIELD: ReadonlyMap<string, EmitterGroup> = new Map(
  Object.entries(GROUP_FIELDS).flatMap(([group, fields]) =>
    fields.map((field) => [nameHash(field), group as EmitterGroup] as const),
  ),
);

/** One group with the emitter's rows in it, in the order the class declared them. */
export interface GroupedRows {
  readonly group: EmitterGroup;
  readonly rows: readonly BinRow[];
}

/** The groups an emitter sets, in card order, skipping those it has no row for. */
export function groupRows(rows: readonly BinRow[]): GroupedRows[] {
  const byGroup = new Map<EmitterGroup, BinRow[]>();
  for (const row of rows) {
    const field = fieldHash(row.path);
    if (field === CARD.name || field === CARD.disabled) continue;
    const group = BY_FIELD.get(field) ?? "other";
    const held = byGroup.get(group);
    if (held === undefined) byGroup.set(group, [row]);
    else held.push(row);
  }

  return GROUP_ORDER.flatMap((group) => {
    const held = byGroup.get(group);
    return held === undefined ? [] : [{ group, rows: held }];
  });
}
