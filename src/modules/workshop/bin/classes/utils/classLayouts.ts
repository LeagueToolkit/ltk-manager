import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import type { ReadRequest } from "../../documents/hooks/useBinRead";
import { nameHash } from "../../shared/utils/binHash";
import { type ShellKind, shellPanesOf } from "../../shell/utils/shellPanes";
import { childCount, fieldHash, rowKey } from "../../tree/utils/binRows";
import type { DefaultField } from "../../vfx/inspector/utils/emitterGroups";

/**
 * How a section draws the fields it names.
 *
 * A widget reads the fields its own class declares, so a section names one only where
 * the class it is written for is the class the widget knows. Everything else takes the
 * cell its row would draw, or the tree.
 */
export type SectionWidget =
  | "rows"
  | "tree"
  | "fields"
  | "icons"
  | "mesh"
  | "override-rows"
  | "effect-table"
  | "condition-rows"
  | "emitters"
  | "clips"
  | "voice-lines"
  | "material-params"
  | "material-samplers"
  | "material-switches"
  | "material-macros"
  | "material-passes"
  | "shader-params"
  | "shader-textures"
  | "shader-switches";

/** Which of a level's answered rows the level under it reads, by field name. */
export type Select = "all" | readonly string[];

/** The levels a widget reads under the fields its section places, one `Select` each. */
export type Descent = readonly Select[];

/**
 * How a view arranges the sections a layout places.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md. The stack is one scrolling column, which every
 * class a modder opens to read wants. A shell is the two columns a class a modder tunes
 * wants, and is the frame ADR-0031 added.
 */
export type LayoutFrame = "stack" | "shell";

/** One section of a layout: what it is called, what it places, and how it draws it. */
export interface LayoutSection {
  readonly title: () => string;
  /** The fields it places, by name, in the order it draws them. */
  readonly fields: readonly string[];
  /** The widget. Absent for the cell the row itself draws. */
  readonly as?: SectionWidget;
  /** The fields under the placed row that `fields` draws, in the order it draws them. */
  readonly under?: readonly string[];
}

/** A layout over one class's depth-zero rows. "Class views" in docs/ux/BIN_EDITOR.md. */
export interface ClassLayout {
  /** The word the mode's segment carries. */
  readonly title: () => string;
  /**
   * The shell it draws in, which names the panes it holds (ADR-0036). Absent for the
   * stack, which is what a layout gets by default.
   */
  readonly shell?: ShellKind;
  readonly sections: readonly LayoutSection[];
  /** The layout lists the fields the object does not author, each at its default. */
  readonly defaults?: boolean;
  /** A stack layout whose widgets take edits in place, as an editable shell's do. */
  readonly editable?: boolean;
  /** The sections draw without headers, for a layout whose one widget is the whole view. */
  readonly headless?: boolean;
}

/** The frame `layout` draws in, which is the stack unless it names a shell. */
export function frameOf(layout: ClassLayout): LayoutFrame {
  return layout.shell === undefined ? "stack" : "shell";
}

/** Whether `layout`'s shell holds a curve pane, which the dock otherwise stands in for. */
export function shellHoldsCurve(layout: ClassLayout): boolean {
  return layout.shell !== undefined && shellPanesOf(layout.shell).includes("curve");
}

/**
 * The material, which a texture modder opens for its samplers.
 *
 * The four fields the wiki groups as the shader's own inputs draw as tables, a row per
 * element and a column per field. The techniques take the tree, which folds a technique
 * to its passes and a pass to its shader without a read per technique. It declares a
 * shell, because the material drawn with its own program is what the fields are judged
 * against (ADR-0047).
 */
export const materialLayout: ClassLayout = {
  title: m.workshop_bin_layout_material_label,
  shell: "material",
  sections: [
    { title: m.workshop_bin_section_identity_label, fields: ["name", "type"] },
    {
      title: m.workshop_bin_section_samplers_label,
      fields: ["samplerValues"],
      as: "material-samplers",
    },
    { title: m.workshop_bin_section_params_label, fields: ["paramValues"], as: "material-params" },
    {
      title: m.workshop_bin_section_switches_label,
      fields: ["switches"],
      as: "material-switches",
    },
    {
      title: m.workshop_bin_section_macros_label,
      fields: ["shaderMacros"],
      as: "material-macros",
    },
    {
      title: m.workshop_bin_section_passes_label,
      fields: ["techniques"],
      as: "material-passes",
    },
    { title: m.workshop_bin_section_techniques_label, fields: ["techniques"], as: "tree" },
  ],
};

/**
 * The layout of a `CustomShaderDef`, the material shell with its parameters, textures and
 * switches as tables. "The material shell" in docs/ux/BIN_EDITOR.md.
 */
export const shaderLayout: ClassLayout = {
  title: m.workshop_bin_layout_shader_label,
  shell: "material",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["objectPath", "ShadingModel", "featureMask", "AdditionalUvSetMask"],
    },
    { title: m.workshop_bin_section_params_label, fields: ["parameters"], as: "shader-params" },
    { title: m.workshop_bin_section_textures_label, fields: ["textures"], as: "shader-textures" },
    {
      title: m.workshop_bin_section_switches_label,
      fields: ["staticSwitches"],
      as: "shader-switches",
    },
    {
      title: m.workshop_bin_section_feature_defines_label,
      fields: ["featureDefines"],
      as: "tree",
    },
  ],
};

/**
 * The skin, which is a hub of links and paths drawn beside the character they build.
 *
 * The mesh and its overrides both hang off `skinMeshProperties`, so two sections place
 * that one row and each draws its own part of what sits under it. It declares a shell,
 * because the posed character is what a reader of a skin is looking at (ADR-0036).
 */
export const skinLayout: ClassLayout = {
  title: m.workshop_bin_layout_skin_label,
  shell: "skin",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["championSkinName", "skinClassification", "skinParent", "armorMaterial"],
    },
    {
      title: m.workshop_bin_section_icons_label,
      fields: ["iconAvatar", "iconCircle", "iconSquare", "loadscreen"],
      as: "icons",
    },
    { title: m.workshop_bin_section_mesh_label, fields: ["skinMeshProperties"], as: "mesh" },
    {
      title: m.workshop_bin_section_overrides_label,
      fields: ["skinMeshProperties"],
      as: "override-rows",
    },
    { title: m.workshop_bin_section_clips_label, fields: ["skinAnimationProperties"], as: "clips" },
    {
      title: m.workshop_bin_section_animation_label,
      fields: ["skinAnimationProperties"],
      as: "fields",
      under: ["animationGraphData"],
    },
    {
      title: m.workshop_bin_section_vfx_label,
      fields: ["idleParticlesEffects", "mResourceResolver"],
      as: "effect-table",
    },
    {
      title: m.workshop_bin_section_conditions_label,
      fields: ["PersistentEffectConditions", "mResourceResolver"],
      as: "condition-rows",
    },
    {
      title: m.workshop_bin_section_audio_label,
      fields: ["skinAudioProperties"],
      as: "fields",
      under: ["bankUnits"],
    },
    { title: m.workshop_bin_section_voice_lines_label, fields: ["mContextualActionData"] },
    { title: m.workshop_bin_section_health_bar_label, fields: ["healthBarData"] },
  ],
};

/**
 * The particle system, which is a list of emitters of 139 fields each.
 *
 * The two emitter lists are one table, because a reader looks for an emitter by name
 * rather than by which of the two holds it. It declares a shell, per ADR-0031, because a
 * particle system is tuned rather than read.
 */
export const vfxLayout: ClassLayout = {
  title: m.workshop_bin_layout_vfx_label,
  shell: "vfx",
  defaults: true,
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: [
        "particleName",
        "particlePath",
        "visibilityRadius",
        "flags",
        "drawingLayer",
        "buildUpTime",
      ],
    },
    {
      title: m.workshop_bin_section_emitters_label,
      fields: ["complexEmitterDefinitionData", "simpleEmitterDefinitionData"],
      as: "emitters",
    },
    {
      title: m.workshop_bin_section_audio_label,
      fields: [
        "soundOnCreateDefault",
        "soundPersistentDefault",
        "voiceOverOnCreateDefault",
        "voiceOverPersistentDefault",
      ],
    },
  ],
};

/**
 * The animation graph, which is a map of clips and the three maps they key into.
 *
 * Stage 7 of docs/plans/animation-graph-table.md. One section draws the four maps as
 * the clips pane's tabs, out of the object itself, and Other holds the blend table and
 * the rest.
 */
export const animationGraphLayout: ClassLayout = {
  title: m.workshop_bin_layout_animation_graph_label,
  sections: [
    {
      title: m.workshop_bin_section_clips_label,
      fields: ["mClipDataMap", "mTrackDataMap", "mMaskDataMap", "mSyncGroupDataMap"],
      as: "clips",
    },
  ],
};

/**
 * The contextual voice of a unit, drawn as its voice lines: a header per situation and a line
 * per rule. "Voice lines" in docs/ux/CONTEXTUAL_VOICE.md.
 *
 * The lines are read typed, through their own command, so the section places the fields the
 * widget draws and Other holds the rest. The widget is the whole view, so no header frames it.
 */
export const voiceLinesLayout: ClassLayout = {
  title: m.workshop_bin_layout_voice_lines_label,
  editable: true,
  headless: true,
  sections: [
    {
      title: m.workshop_bin_section_voice_lines_label,
      fields: ["mSituations", "mCooldown", "mHealthPercentThreshold", "mObjectPath"],
      as: "voice-lines",
    },
  ],
};

/**
 * The map, which lists the skins it plays under and draws the one a reader picks.
 *
 * It declares a shell as its skin and its container do, because the drawn map is what a
 * reader of any of the three is looking at.
 */
export const mapLayout: ClassLayout = {
  title: m.workshop_bin_layout_map_label,
  shell: "map",
  sections: [
    { title: m.workshop_bin_section_identity_label, fields: ["mapStringId", "BasedOnMap"] },
    { title: m.workshop_bin_section_map_skins_label, fields: ["mapSkins"], as: "rows" },
    {
      title: m.workshop_bin_section_characters_label,
      fields: ["characterLists", "SharedCharacterLists"],
      as: "rows",
    },
  ],
};

/** The map skin, which names the container whose geometry it draws. */
export const mapSkinLayout: ClassLayout = {
  title: m.workshop_bin_layout_map_skin_label,
  shell: "map",
  sections: [
    { title: m.workshop_bin_section_identity_label, fields: ["name", "mMapContainerLink"] },
    {
      title: m.workshop_bin_section_look_label,
      fields: [
        "mSkyboxCubemapTexture",
        "mGrassTintTexture",
        "mColorizationPostEffect",
        "GammaParameters",
        "ShadowsEnabled",
      ],
    },
    { title: m.workshop_bin_section_minimap_label, fields: ["mMinimapBackgroundConfig"] },
    { title: m.workshop_bin_section_vfx_label, fields: ["WorldParticles", "mResourceResolvers"] },
  ],
};

/** The map container, which states the map its file draws and the chunks it is cut into. */
export const mapContainerLayout: ClassLayout = {
  title: m.workshop_bin_layout_map_container_label,
  shell: "map",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["mapPath", "boundsMin", "boundsMax", "lowestWalkableHeight"],
    },
    /* `chunks` has no section: the outliner lists the chunks with what each holds. */
    { title: m.workshop_bin_section_components_label, fields: ["components"], as: "tree" },
  ],
};

/**
 * A UI view controller, drawn in Atlas: its scenes laid out on a screen and its tree beside them.
 *
 * Keyed on the `ViewController` base, since each of the 154 subclasses is C++ behaviour over the
 * same loadables, per decision 1 of docs/plans/atlas-ui-editor.md.
 */
export const atlasLayout: ClassLayout = {
  title: m.workshop_bin_layout_atlas_label,
  shell: "atlas",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["PathHashToSelf", "BaseLoadable"],
    },
  ],
};

/**
 * One scene bin a view controller loads, drawn in Atlas as that controller's base. Its subclass
 * `UiComponent` is a binding template rather than a scene bin, so this layout is exact.
 */
export const atlasLoadableLayout: ClassLayout = {
  title: m.workshop_bin_layout_atlas_label,
  shell: "atlas",
  sections: [{ title: m.workshop_bin_section_identity_label, fields: ["FilepathHash"] }],
};

/** One UI element, drawn alone as its view draws it, beside where it sits and what it draws with. */
export const elementLayout: ClassLayout = {
  title: m.workshop_bin_layout_element_label,
  shell: "element",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["name", "Scene", "Enabled", "Layer"],
    },
    { title: m.workshop_bin_section_position_label, fields: ["Position"], as: "tree" },
  ],
};

/** A text font, drawn as a text draws it in Atlas, beside its type, sizes and colours. */
export const fontLayout: ClassLayout = {
  title: m.workshop_bin_layout_font_label,
  shell: "font",
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["name", "typeData", "resolutionData"],
    },
    {
      title: m.workshop_bin_section_look_label,
      fields: ["Color", "outlineColor", "shadowColor", "glowColor", "fillTextureName"],
    },
  ],
};

/**
 * Every layout, by the class hash it draws.
 *
 * Each subclass is listed by hand, since a layout here draws exactly its class. A layout that
 * draws every class under a base is in `BASE_LAYOUTS` instead.
 */
const LAYOUTS: ReadonlyMap<string, ClassLayout> = new Map([
  [nameHash("StaticMaterialDef"), materialLayout],
  [nameHash("CustomShaderDef"), shaderLayout],
  [nameHash("SkinCharacterDataProperties"), skinLayout],
  [nameHash("TftSkinCharacterDataProperties"), skinLayout],
  [nameHash("VfxSystemDefinitionData"), vfxLayout],
  [nameHash("AnimationGraphData"), animationGraphLayout],
  [nameHash("ContextualActionData"), voiceLinesLayout],
  [nameHash("Map"), mapLayout],
  [nameHash("MapSkin"), mapSkinLayout],
  [nameHash("MapContainer"), mapContainerLayout],
  [nameHash("UiPropertyLoadable"), atlasLoadableLayout],
  [nameHash("GameFontDescription"), fontLayout],
]);

/** The layouts a class takes from a base it derives from, by the base's class hash. */
const BASE_LAYOUTS: ReadonlyMap<string, ClassLayout> = new Map([
  [nameHash("ViewController"), atlasLayout],
  [nameHash("UiElementIData"), elementLayout],
]);

/** Each base whose layout its derived classes take, with that layout. */
export const INHERITED_LAYOUTS: readonly (readonly [string, ClassLayout])[] = [...BASE_LAYOUTS];

/**
 * The layout `classHash` opens in, or undefined for a class that has none.
 *
 * `bases` are the classes it derives from, nearest first, as the meta schema lists them. A
 * class without a layout of its own takes the nearest base's from `BASE_LAYOUTS`.
 */
export function classLayout(
  classHash: string,
  bases: readonly string[] = [],
): ClassLayout | undefined {
  const own = LAYOUTS.get(classHash);
  if (own !== undefined) return own;

  for (const base of bases) {
    const inherited = BASE_LAYOUTS.get(base);
    if (inherited !== undefined) return inherited;
  }
  return undefined;
}

/** The hashes a section's fields are addressed by, in the order it draws them. */
export function sectionFields(section: LayoutSection): string[] {
  return section.fields.map(nameHash);
}

/** One section with the rows it drew, in the order the layout named its fields. */
export interface PlacedSection {
  /** What the section is remembered by, its widget and the fields it names. */
  readonly id: string;
  readonly title: () => string;
  /** The widget. Absent for the cell each row itself draws. */
  readonly widget: SectionWidget | undefined;
  readonly rows: readonly BinRow[];
  /** The fields under the placed row that `fields` draws, in the order it draws them. */
  readonly under: readonly string[];
  /** The fields the object does not author that the section draws at their defaults. */
  readonly defaults: readonly DefaultField[];
  /** The last section, which holds what no other named. */
  readonly other: boolean;
  /** The section draws without a header, as `ClassLayout.headless` sets. */
  readonly headless: boolean;
}

/**
 * Every depth-zero row placed in a section, the ones no section names in a last one.
 *
 * "A layout is complete" in docs/ux/BIN_EDITOR.md. Other is the field rows of what is
 * left, so a field the game adds in a patch is on screen the day the schema changes,
 * and a field the layout names and the object lacks draws nothing unless it is in `defaults`.
 *
 * Each of `defaults` goes to the section of field rows that names it, or to Other if no
 * section names it. A default that a widget's section names is skipped, because the
 * widget draws that field.
 */
export function placeRows(
  roots: readonly BinRow[],
  layout: ClassLayout,
  defaults: readonly DefaultField[] = [],
): PlacedSection[] {
  const byField = new Map(roots.map((row) => [fieldHash(row.path), row]));
  const defaultByField = new Map(defaults.map((field) => [field.hash, field]));
  const taken = new Set<string>();
  const placed: PlacedSection[] = [];

  for (const section of layout.sections) {
    const rows: BinRow[] = [];
    const sectionDefaults: DefaultField[] = [];
    for (const hash of sectionFields(section)) {
      taken.add(hash);

      const row = byField.get(hash);
      if (row !== undefined) {
        rows.push(row);
        continue;
      }

      const field = defaultByField.get(hash);
      if (field !== undefined && section.as === undefined) sectionDefaults.push(field);
    }
    placed.push({
      id: `${section.as ?? "cells"}:${section.fields.join(",")}`,
      title: section.title,
      widget: section.as,
      rows,
      under: section.under ?? [],
      defaults: sectionDefaults,
      other: false,
      headless: layout.headless === true,
    });
  }

  placed.push({
    id: "other",
    title: m.workshop_bin_section_other_label,
    widget: undefined,
    rows: roots.filter((row) => !taken.has(fieldHash(row.path))),
    under: [],
    defaults: defaults.filter((field) => !taken.has(field.hash)),
    other: true,
    headless: layout.headless === true,
  });
  return placed;
}

/**
 * How many things a section lists, for its header, and null for a section of named fields.
 *
 * A list's elements are what a reader counts, so a widget over lists counts those, and
 * Other counts the fields it was left.
 */
export function sectionCount(
  section: PlacedSection,
  pages: ReadonlyMap<string, Page>,
): number | null {
  const lists = (rows: readonly BinRow[]) =>
    rows.reduce((sum, row) => sum + (isList(row) ? childCount(row) : 0), 0);

  if (section.other) return section.rows.length + section.defaults.length;
  switch (section.widget) {
    case "rows":
    case "emitters":
    case "material-params":
    case "material-samplers":
    case "material-switches":
    case "shader-params":
    case "shader-textures":
    case "shader-switches":
      return lists(section.rows);
    case "material-macros":
      return section.rows.reduce((sum, row) => sum + childCount(row), 0);
    case "material-passes": {
      /* Every technique's passes, which is the drawn one's for the material of one technique. */
      const passes = section.rows
        .flatMap((row) => pages.get(rowKey(row))?.rows ?? [])
        .flatMap(
          (technique) =>
            pages
              .get(rowKey(technique))
              ?.rows.filter((child) => fieldHash(child.path) === TECHNIQUE_PASSES) ?? [],
        );
      return passes.length === 0 ? null : lists(passes);
    }
    case "effect-table":
    case "condition-rows":
      return lists(section.rows.filter((row) => fieldHash(row.path) !== EFFECT.resolver));
    case "override-rows":
      return lists(
        section.rows.flatMap(
          (row) =>
            pages
              .get(rowKey(row))
              ?.rows.filter((child) => fieldHash(child.path) === MESH.override) ?? [],
        ),
      );
    default:
      return null;
  }
}

/** `StaticMaterialTechniqueDef.passes`. */
const TECHNIQUE_PASSES = nameHash("passes");

function isList(row: BinRow): boolean {
  return row.value.type === "container" || row.value.type === "map";
}

/**
 * How far under its own fields each widget reads.
 *
 * "What a layout reads" in docs/ux/BIN_EDITOR.md. A widget costs the containers the
 * layout placed and then the elements of each. A widget that wants one field of a
 * nested struct names it, so the level under it carries that field alone rather than
 * every struct the level above answered.
 */
const DESCENT: Record<SectionWidget, Descent> = {
  tree: [],
  fields: ["all"],
  icons: ["all"],
  mesh: ["all"],
  /* The elements alone. The tree fetches what sits under each of them itself. */
  rows: ["all"],
  "effect-table": ["all", "all"],
  /* The third level is each driver's fields, which the condition's row is summarized by. The
     effects and the submeshes are read when the row is unfolded. */
  "condition-rows": ["all", "all", ["OwnerCondition", "SourceCondition"]],
  /* The third level is each override's fields, which name the submesh its row is titled by. */
  "override-rows": [["materialOverride"], "all", "all"],
  emitters: ["all", ["CustomMaterial"], "all"],
  /* The graph is read typed, through its own command, and not through the rows. */
  clips: [],
  /* The voice lines are read typed, through their own command. */
  "voice-lines": [],
  /* Each list's elements, then each element's fields, which are the table's columns. */
  "material-params": ["all", "all"],
  "material-samplers": ["all", "all"],
  "material-switches": ["all", "all"],
  /* A macro is a map entry, which holds its value itself. */
  "material-macros": ["all"],
  /* Each technique, its `passes`, then each pass. The widget reads each pass's fields itself. */
  "material-passes": ["all", ["passes"], "all"],
  "shader-params": ["all", "all"],
  "shader-textures": ["all", "all"],
  "shader-switches": ["all", "all"],
};

/** How far under its own fields a section's widget reads. Nothing, without one. */
export function descentOf(widget: SectionWidget | undefined): Descent {
  return widget === undefined ? [] : DESCENT[widget];
}

/** The most levels a widget reads, which is how many reads `useLayoutRead` makes. */
export const MAX_LEVELS = 3;

/**
 * The widgets that read the value marks of the cells they draw.
 *
 * A table of named columns reads a mark for those columns alone. The view reading every
 * row its levels answered would ask for one on each of an emitter's own hundred-odd
 * fields, which is a read per field of a table that draws four.
 */
const OWN_MARKS: ReadonlySet<SectionWidget> = new Set<SectionWidget>(["emitters"]);

/** Whether a section's widget reads its own value marks. */
export function readsOwnMarks(widget: SectionWidget | undefined): boolean {
  return widget !== undefined && OWN_MARKS.has(widget);
}

/** A page of rows as a level reads one, which is what the projected read answers. */
type Page = { readonly rows: readonly BinRow[] };

/**
 * The nodes level `level` reads, out of the placed fields and what the levels above
 * it answered.
 *
 * A row that holds nothing is asked for at no level, so an empty list and a leaf both
 * cost a layout no path in its call.
 */
export function levelRequests(
  placed: readonly PlacedSection[],
  pages: ReadonlyMap<string, Page>,
  level: number,
): ReadRequest[] {
  const requests: ReadRequest[] = [];
  for (const section of placed) {
    const descent = descentOf(section.widget);
    if (level >= descent.length) continue;
    for (const row of atLevel(section, descent, pages, level)) {
      const rows = childCount(row);
      if (rows === 0) continue;
      requests.push({ key: rowKey(row), rows });
    }
  }
  return requests;
}

/** The rows a section's level `level` reads under, walked down from its placed fields. */
function atLevel(
  section: PlacedSection,
  descent: Descent,
  pages: ReadonlyMap<string, Page>,
  level: number,
): readonly BinRow[] {
  let rows = section.rows;
  for (let at = 0; at < level; at += 1) {
    const answered = rows.flatMap((row) => pages.get(rowKey(row))?.rows ?? []);
    rows = selected(answered, descent[at] ?? "all");
  }
  return rows;
}

/** The rows a `Select` carries into the level under the one that answered them. */
function selected(rows: readonly BinRow[], select: Select): BinRow[] {
  if (select === "all") return [...rows];
  const wanted = new Set(select.map(nameHash));
  return rows.filter((row) => wanted.has(fieldHash(row.path)));
}

/** The image a censored icon holds under it, which is the chunk the tile draws. */
export const CENSORED_IMAGE = nameHash("image");

/** The fields of the mesh a skin draws, and the override list beside them. */
export const MESH = {
  simpleSkin: nameHash("simpleSkin"),
  skeleton: nameHash("skeleton"),
  texture: nameHash("texture"),
  emissive: nameHash("emissiveTexture"),
  normalMap: nameHash("normalMapTexture"),
  gloss: nameHash("glossTexture"),
  roughness: nameHash("RoughnessMetallicAoTexture"),
  material: nameHash("Material"),
  override: nameHash("materialOverride"),
  submesh: nameHash("submesh"),
} as const;

/** The fields of one idle effect, and the resolver its key resolves through. */
export const EFFECT = {
  key: nameHash("effectKey"),
  name: nameHash("effectName"),
  bone: nameHash("boneName"),
  targetBone: nameHash("targetBoneName"),
  resolver: nameHash("mResourceResolver"),
  resourceMap: nameHash("resourceMap"),
} as const;

/** The fields of one persistent condition, and the driver fields its row is summarized by. */
export const CONDITION = {
  list: nameHash("PersistentEffectConditions"),
  effects: nameHash("PersistentVfxs"),
  owner: nameHash("OwnerCondition"),
  source: nameHash("SourceCondition"),
  shown: nameHash("SubmeshesToShow"),
  hidden: nameHash("SubmeshesToHide"),
  spell: nameHash("Spell"),
  drivers: nameHash("mDrivers"),
} as const;
