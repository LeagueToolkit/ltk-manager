import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { fieldHash } from "./binRows";

/**
 * How a section draws the fields it names.
 *
 * A widget reads the fields its own class declares, so a section names one only where
 * the class it is written for is the class the widget knows. Everything else takes the
 * cell its row would draw, or the tree.
 */
export type SectionWidget = "sampler-table" | "param-table" | "switch-list" | "tree";

/** One section of a layout: what it is called, what it places, and how it draws it. */
export interface LayoutSection {
  readonly title: () => string;
  /** The fields it places, by name, in the order it draws them. */
  readonly fields: readonly string[];
  /** The widget. Absent for the cell the row itself draws. */
  readonly as?: SectionWidget;
}

/** A layout over one class's depth-zero rows. "Class views" in docs/ux/BIN_EDITOR.md. */
export interface ClassLayout {
  /** The word the mode's segment carries. */
  readonly title: () => string;
  readonly sections: readonly LayoutSection[];
}

/**
 * The material, which a texture modder opens for its samplers.
 *
 * The four fields the wiki groups as the shader's own inputs take tables. The
 * techniques take the tree, which folds a technique to its passes and a pass to its
 * shader without a widget per level and without a read per technique.
 */
export const materialLayout: ClassLayout = {
  title: m.workshop_bin_layout_material_label,
  sections: [
    { title: m.workshop_bin_section_identity_label, fields: ["name", "type"] },
    {
      title: m.workshop_bin_section_samplers_label,
      fields: ["samplerValues"],
      as: "sampler-table",
    },
    { title: m.workshop_bin_section_params_label, fields: ["paramValues"], as: "param-table" },
    { title: m.workshop_bin_section_switches_label, fields: ["switches"], as: "switch-list" },
    { title: m.workshop_bin_section_macros_label, fields: ["shaderMacros"], as: "tree" },
    { title: m.workshop_bin_section_techniques_label, fields: ["techniques"], as: "tree" },
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
    placed.push({ title: section.title, widget: section.as, rows, other: false });
  }

  placed.push({
    title: m.workshop_bin_section_other_label,
    widget: "tree",
    rows: roots.filter((row) => !taken.has(fieldHash(row.path))),
    other: true,
  });
  return placed;
}

/** The fields a sampler's cell reads, by hash. */
export const SAMPLER = {
  textureName: nameHash("TextureName"),
  samplerName: nameHash("samplerName"),
  texturePath: nameHash("texturePath"),
  addressU: nameHash("addressU"),
  addressV: nameHash("addressV"),
  addressW: nameHash("addressW"),
  filterMag: nameHash("filterMag"),
  filterMin: nameHash("filterMin"),
} as const;

/** The fields a param's and a switch's cell read, which share a name field. */
export const NAMED = {
  name: nameHash("name"),
  value: nameHash("value"),
  on: nameHash("on"),
} as const;
