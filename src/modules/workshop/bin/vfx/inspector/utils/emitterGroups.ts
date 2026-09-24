import { m } from "@/i18n";
import type { BinRow, FieldSchema, KindShape } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import { fieldHash } from "../../../tree/utils/binRows";

/** One component group of an emitter, in the order a card lists them. */
export type EmitterGroup =
  | "emission"
  | "birth"
  | "initialMotion"
  | "motion"
  | "position"
  | "scale"
  | "colour"
  | "primitive"
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
    "birthRotation0",
    "birthFrameRate",
    "birthUVOffset",
    "flexBirthUVOffset",
    "birthUvRotateRate",
    "birthUvScrollRate",
    "flexBirthUVScrollRate",
    "flexScaleBirthScale",
  ],
  initialMotion: [
    "birthVelocity",
    "flexBirthVelocity",
    "birthAcceleration",
    "birthOrbitalVelocity",
    "birthDrag",
    "birthRotationalVelocity0",
    "flexBirthRotationalVelocity0",
    "birthRotationalAcceleration",
  ],
  motion: ["velocity", "acceleration", "worldAcceleration", "drag"],
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
  primitive: ["primitive"],
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
  initialMotion: m.workshop_bin_emitter_group_initial_motion_label,
  motion: m.workshop_bin_emitter_group_motion_label,
  position: m.workshop_bin_emitter_group_position_label,
  scale: m.workshop_bin_emitter_group_scale_label,
  colour: m.workshop_bin_emitter_group_colour_label,
  primitive: m.workshop_bin_emitter_group_primitive_label,
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
  "initialMotion",
  "motion",
  "position",
  "scale",
  "colour",
  "primitive",
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

const FIELD_ORDER: ReadonlyMap<string, number> = new Map(
  Object.values(GROUP_FIELDS)
    .flat()
    .map((field, index) => [nameHash(field), index]),
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

/** A field the class declares and the emitter does not author, which Defaults lists. */
export interface DefaultField {
  /** `0x` and eight hex digits. */
  readonly hash: string;
  /** The field as the schema names it, or its hash where the database names it none. */
  readonly name: string;
  /** The type at the install's build, and null where no revision covers it. */
  readonly declared: KindShape | null;
  readonly classHash?: string | null;
  readonly defaultValue?: string | null;
}

/** One inspector section's authored properties and implicit defaults. */
export interface InspectorGroup {
  readonly group: EmitterGroup;
  readonly rows: readonly BinRow[];
  readonly defaults: readonly DefaultField[];
}

/** A property slot identified independently of whether it has an authored value. */
export type InspectorProperty =
  | { readonly hash: string; readonly row: BinRow }
  | { readonly hash: string; readonly field: DefaultField };

/** Authored values and defaults in authoring order, with unclassified fields ordered by hash. */
export function inspectorProperties({ rows, defaults }: InspectorGroup): InspectorProperty[] {
  const properties: InspectorProperty[] = rows.map((row) => ({ hash: fieldHash(row.path), row }));
  for (const field of defaults) {
    properties.push({ hash: field.hash, field });
  }

  return properties.sort((left, right) => {
    const leftOrder = FIELD_ORDER.get(left.hash) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = FIELD_ORDER.get(right.hash) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder || left.hash.localeCompare(right.hash);
  });
}

/**
 * The fields of `fields` that no hash in `authored` names, in the schema's own order.
 *
 * The two the card draws are left out wherever they come from, the way `groupRows`
 * leaves them out of a group.
 */
export function unauthoredFields(
  fields: readonly FieldSchema[],
  authored: ReadonlySet<string>,
): DefaultField[] {
  return fields
    .filter((field) => !authored.has(field.hash))
    .filter((field) => field.hash !== CARD.name && field.hash !== CARD.disabled)
    .map(defaultField);
}

/** A field of the schema as a row drawn at its default reads it. */
export function defaultField(field: FieldSchema): DefaultField {
  return {
    hash: field.hash,
    name: field.name ?? field.hash,
    declared: field.declared,
    classHash: field.classHash,
    defaultValue: field.defaultValue,
  };
}

/** `groups` with every default under the group its field falls in, in card order. */
export function inspectorGroups(
  groups: readonly GroupedRows[],
  defaults: readonly DefaultField[],
): InspectorGroup[] {
  const byGroup = new Map<EmitterGroup, DefaultField[]>();
  for (const field of defaults) {
    const group = BY_FIELD.get(field.hash) ?? "other";
    const held = byGroup.get(group);
    if (held === undefined) byGroup.set(group, [field]);
    else held.push(field);
  }

  const authored = new Map(groups.map((each) => [each.group, each.rows] as const));
  return GROUP_ORDER.flatMap((group) => {
    const rows = authored.get(group);
    const held = byGroup.get(group);
    if (rows === undefined && held === undefined) return [];
    return [{ group, rows: rows ?? [], defaults: held ?? [] }];
  });
}
