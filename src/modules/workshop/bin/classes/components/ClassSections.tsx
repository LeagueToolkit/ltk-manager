import { CaretRightIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useMemo } from "react";

import { Count } from "@/components";
import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";
import { useSectionOpen, useToggleSection } from "@/stores";
import { twMerge } from "@/utils";

import { VoiceLinesSection } from "../../../audio/components/VoiceLinesView";
import { MaterialMacros } from "../../material/components/MaterialMacros";
import { MaterialPasses } from "../../material/components/MaterialPasses";
import {
  MaterialParams,
  MaterialSamplers,
  MaterialSwitches,
} from "../../material/components/MaterialTables";
import {
  ShaderParams,
  ShaderSwitches,
  ShaderTextures,
} from "../../material/components/ShaderTables";
import { objectRow } from "../../material/utils/entryEdits";
import { nameHash } from "../../shared/utils/binHash";
import { nameColumn } from "../../shared/utils/textCut";
import { ClipsSection } from "../../skin/components/ClipsSection";
import { ConditionRows } from "../../skin/components/ConditionRows";
import { EffectTable } from "../../skin/components/EffectTable";
import { IconRow, MeshCard, OverrideRows } from "../../skin/components/SkinSections";
import { rowKey } from "../../tree/utils/binRows";
import { DefaultProperty } from "../../vfx/inspector/components/DefaultProperty";
import { Emitters } from "../../vfx/inspector/components/VfxSections";
import { type PlacedSection, type SectionWidget, sectionCount } from "../utils/classLayouts";
import {
  elementsOf,
  FieldRows,
  fieldsIn,
  type LayoutPages,
  NAME_COLUMN,
  SectionTree,
  type ViewContext,
  type WidgetProps,
} from "./ClassCells";

/** The share of a section past which the name column cuts its names. */
const NAME_CAP = "40%";

/** What the column holds beside a name, in pixels: the caret's gutter and the row's padding. */
const NAME_EXTRA = 16;

/** The widgets whose rows are field rows, which the name column is measured over. */
const FIELD_ROW_WIDGETS: ReadonlySet<SectionWidget | undefined> = new Set([
  undefined,
  "rows",
  "fields",
  "mesh",
  "override-rows",
  "condition-rows",
]);

/** Every placed section, in the order the layout named them, over one name column. */
export function Sections({
  placed,
  pages,
  view,
}: {
  placed: readonly PlacedSection[];
  pages: LayoutPages;
  view: ViewContext;
}) {
  const column = useMemo(
    () =>
      ({
        "--name-width": nameColumn(fieldRowNames(placed, pages), NAME_EXTRA, NAME_CAP),
      }) as CSSProperties,
    [placed, pages],
  );

  return (
    <div data-ui="ClassView:sections" className="contents" style={column}>
      {placed.map((section) => (
        <Section key={section.id} section={section} pages={pages} view={view} />
      ))}
    </div>
  );
}

/** The names a layout draws as field rows, which the name column is measured over. */
function fieldRowNames(placed: readonly PlacedSection[], pages: LayoutPages): string[] {
  const names: string[] = [];
  const under = (rows: readonly BinRow[]) => {
    for (const row of rows) {
      const page = pages.get(rowKey(row));
      if (page === undefined) continue;
      names.push(...page.rows.map((child) => child.name));
      under(page.rows);
    }
  };

  for (const section of placed) {
    if (!FIELD_ROW_WIDGETS.has(section.widget)) continue;
    if (section.widget === undefined) {
      names.push(...section.rows.map((row) => row.name));
      names.push(...section.defaults.map((field) => field.name));
    } else under(section.rows);
  }
  return names;
}

interface SectionProps {
  section: PlacedSection;
  pages: LayoutPages;
  view: ViewContext;
}

/** One section: its header, and the fields it placed. */
function Section({ section, pages, view }: SectionProps) {
  const id = `bin-section:${view.classHash}:${section.id}`;
  const open = useSectionOpen(id) ?? true;
  const toggle = useToggleSection();
  const title = section.title();
  /* The conditions widget holds the add that creates its list, so it draws with no list. */
  const empty =
    section.rows.length === 0 &&
    section.defaults.length === 0 &&
    section.widget !== "condition-rows";
  const count = empty ? null : sectionCount(section, pages);

  if (section.headless) {
    if (empty && section.other) return null;

    return (
      <section data-ui="ClassView:section" className="font-mono text-mono-row">
        <SectionBody section={section} pages={pages} view={view} title={title} />
      </section>
    );
  }

  return (
    <section
      data-ui="ClassView:section"
      className="flex flex-col gap-1 border-t border-surface-700/40 pt-2 first:border-t-0 first:pt-0"
    >
      <div
        /* DS-GROUND: opaque, since the rows scroll under it rather than past it. */
        className={twMerge(
          "sticky top-0 z-10 flex items-center gap-1.5 py-0.5",
          view.frame === "shell" ? "bg-surface-900" : "bg-surface-950",
        )}
      >
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 text-left text-surface-300 hover:text-surface-100"
          aria-expanded={open}
          onClick={() => toggle(id, !open)}
        >
          <CaretRightIcon weight="bold" className={twMerge("size-3", open && "rotate-90")} />
          <span className="text-xs font-medium tracking-wide uppercase">{title}</span>
        </button>
        {count !== null && <Count>{count}</Count>}
        {empty && (
          <span className="text-meta text-surface-400">{m.workshop_bin_section_none_empty()}</span>
        )}
      </div>
      {open && !empty && (
        <div className="pl-3 font-mono text-mono-row">
          <SectionBody section={section} pages={pages} view={view} title={title} />
        </div>
      )}
    </section>
  );
}

/** What each widget draws for the section that names it. */
const WIDGETS: Record<Exclude<SectionWidget, "tree">, (props: WidgetProps) => ReactNode> = {
  rows: ElementRows,
  fields: NamedFields,
  icons: IconRow,
  mesh: MeshCard,
  "override-rows": OverrideRows,
  "effect-table": EffectTable,
  "condition-rows": ConditionRows,
  "material-params": MaterialParams,
  "material-samplers": MaterialSamplers,
  "material-switches": MaterialSwitches,
  "material-macros": MaterialMacros,
  "material-passes": MaterialPasses,
  "shader-params": ShaderParams,
  "shader-textures": ShaderTextures,
  "shader-switches": ShaderSwitches,
  emitters: Emitters,
  clips: ClipsSection,
  "voice-lines": VoiceLinesSection,
};

function SectionBody({ section, pages, view, title }: SectionProps & { title: string }) {
  if (section.widget === "tree") {
    return (
      <SectionTree
        view={view}
        roots={section.rows}
        rootOwner={view.classHash}
        label={title}
        initialExpanded={section.rows.map(rowKey)}
      />
    );
  }

  if (section.widget === undefined) {
    return (
      <>
        {section.rows.length > 0 && <FieldRows rows={section.rows} owner={view.classHash} />}
        {section.defaults.length > 0 && <DefaultRows section={section} view={view} />}
      </>
    );
  }

  const Widget = WIDGETS[section.widget];
  return <Widget section={section} pages={pages} view={view} />;
}

/** One row per field the object does not author, each at its default and editable in place. */
function DefaultRows({ section, view }: { section: PlacedSection; view: ViewContext }) {
  const holder = useMemo(() => objectRow(view.entry), [view.entry]);

  return (
    <div className="flex flex-col gap-0.5">
      {section.defaults.map((field) => (
        <DefaultProperty
          key={field.hash}
          field={field}
          holder={holder}
          width={NAME_COLUMN}
          owner={view.classHash}
          tableLayout={false}
        />
      ))}
    </div>
  );
}

/** The fields the section names under the one row it placed, each on a line of its own. */
function NamedFields({ section, pages }: WidgetProps) {
  const byField = fieldsIn(elementsOf(section.rows, pages));
  const drawn = section.under
    .map((name) => byField(nameHash(name)))
    .filter((row): row is BinRow => row !== undefined);

  return <FieldRows rows={drawn} />;
}

/** One field row per element of the containers the section placed, each opening in place. */
function ElementRows({ section, pages }: WidgetProps) {
  return <FieldRows rows={elementsOf(section.rows, pages)} />;
}
