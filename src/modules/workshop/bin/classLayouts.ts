import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { childCount, fieldHash, rowKey } from "./binRows";
import type { ReadRequest } from "./useBinRead";

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
  | "emitters";

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
  /** The frame it draws in. Absent for the stack, which is what a layout gets by default. */
  readonly frame?: LayoutFrame;
  readonly sections: readonly LayoutSection[];
}

/** The frame `layout` draws in, which is the stack unless it names another. */
export function frameOf(layout: ClassLayout): LayoutFrame {
  return layout.frame ?? "stack";
}

/**
 * The material, which a texture modder opens for its samplers.
 *
 * The four fields the wiki groups as the shader's own inputs are lists, and a list
 * draws as the rows a reader opens further. The techniques take the tree, which folds a
 * technique to its passes and a pass to its shader without a read per technique.
 */
export const materialLayout: ClassLayout = {
  title: m.workshop_bin_layout_material_label,
  sections: [
    { title: m.workshop_bin_section_identity_label, fields: ["name", "type"] },
    { title: m.workshop_bin_section_samplers_label, fields: ["samplerValues"], as: "rows" },
    { title: m.workshop_bin_section_params_label, fields: ["paramValues"], as: "rows" },
    { title: m.workshop_bin_section_switches_label, fields: ["switches"], as: "rows" },
    { title: m.workshop_bin_section_macros_label, fields: ["shaderMacros"], as: "tree" },
    { title: m.workshop_bin_section_techniques_label, fields: ["techniques"], as: "tree" },
  ],
};

/**
 * The skin, which is a hub of links and paths rather than a table of its own.
 *
 * The mesh and its overrides both hang off `skinMeshProperties`, so two sections place
 * that one row and each draws its own part of what sits under it.
 */
export const skinLayout: ClassLayout = {
  title: m.workshop_bin_layout_skin_label,
  sections: [
    {
      title: m.workshop_bin_section_identity_label,
      fields: ["championSkinName", "skinClassification", "skinParent"],
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
      title: m.workshop_bin_section_audio_label,
      fields: ["skinAudioProperties"],
      as: "fields",
      under: ["bankUnits"],
    },
  ],
};

/**
 * The particle system, which is a list of emitters of 139 fields each.
 *
 * The two emitter lists are one table, because a reader looks for an emitter by name
 * rather than by which of the two holds it. It is the one layout that declares a shell,
 * per ADR-0031, because a particle system is tuned rather than read.
 */
export const vfxLayout: ClassLayout = {
  title: m.workshop_bin_layout_vfx_label,
  frame: "shell",
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
 * Every layout, by the class hash it draws.
 *
 * Each subclass is listed by hand, because the meta schema carries no inheritance and
 * a layout keyed on a base class would draw nothing for the class that derives it.
 */
const LAYOUTS: ReadonlyMap<string, ClassLayout> = new Map([
  [nameHash("StaticMaterialDef"), materialLayout],
  [nameHash("SkinCharacterDataProperties"), skinLayout],
  [nameHash("TftSkinCharacterDataProperties"), skinLayout],
  [nameHash("VfxSystemDefinitionData"), vfxLayout],
]);

/** The layout `classHash` opens in, or undefined for a class that has none. */
export function classLayout(classHash: string): ClassLayout | undefined {
  return LAYOUTS.get(classHash);
}

/** The hashes a section's fields are addressed by, in the order it draws them. */
export function sectionFields(section: LayoutSection): string[] {
  return section.fields.map(nameHash);
}

/** One section with the rows it drew, in the order the layout named its fields. */
export interface PlacedSection {
  readonly title: () => string;
  /** The widget. Absent for the cell each row itself draws. */
  readonly widget: SectionWidget | undefined;
  readonly rows: readonly BinRow[];
  /** The fields under the placed row that `fields` draws, in the order it draws them. */
  readonly under: readonly string[];
  /** The last section, which holds what no other named. */
  readonly other: boolean;
}

/**
 * Every depth-zero row placed in a section, the ones no section names in a last one.
 *
 * "A layout is complete" in docs/ux/BIN_EDITOR.md. Other is the tree rooted at what is
 * left, so a field the game adds in a patch is on screen the day the schema changes,
 * and a field the layout names and the object lacks draws nothing.
 */
export function placeRows(roots: readonly BinRow[], layout: ClassLayout): PlacedSection[] {
  const byField = new Map(roots.map((row) => [fieldHash(row.path), row]));
  const taken = new Set<string>();
  const placed: PlacedSection[] = [];

  for (const section of layout.sections) {
    const rows: BinRow[] = [];
    for (const hash of sectionFields(section)) {
      const row = byField.get(hash);
      if (row === undefined) continue;
      rows.push(row);
      taken.add(hash);
    }
    placed.push({
      title: section.title,
      widget: section.as,
      rows,
      under: section.under ?? [],
      other: false,
    });
  }

  placed.push({
    title: m.workshop_bin_section_other_label,
    widget: "tree",
    rows: roots.filter((row) => !taken.has(fieldHash(row.path))),
    under: [],
    other: true,
  });
  return placed;
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
  "override-rows": [["materialOverride"], "all"],
  emitters: ["all", ["CustomMaterial"], "all"],
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
} as const;

/** The fields of one idle effect, and the resolver its key resolves through. */
export const EFFECT = {
  key: nameHash("effectKey"),
  bone: nameHash("boneName"),
  resolver: nameHash("mResourceResolver"),
  resourceMap: nameHash("resourceMap"),
} as const;
