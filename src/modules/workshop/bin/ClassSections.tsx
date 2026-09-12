import { CaretRightIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useMemo } from "react";

import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";
import { useSectionOpen, useToggleSection } from "@/stores";
import { twMerge } from "@/utils";

import { nameHash } from "./binHash";
import { rowKey } from "./binRows";
import {
  elementsOf,
  FieldRows,
  fieldsIn,
  type LayoutPages,
  SectionTree,
  type ViewContext,
  type WidgetProps,
} from "./ClassCells";
import { type PlacedSection, type SectionWidget, sectionCount } from "./classLayouts";
import { EffectTable, IconRow, MeshCard, OverrideRows } from "./SkinSections";
import { nameColumn } from "./textCut";
import { Emitters } from "./VfxSections";

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
    if (section.widget === undefined) names.push(...section.rows.map((row) => row.name));
    else under(section.rows);
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
  const empty = section.rows.length === 0;
  const count = empty ? null : sectionCount(section, pages);

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
          <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
          <span className="text-xs font-medium tracking-wide uppercase">{title}</span>
        </button>
        {count !== null && <span className="text-meta text-surface-400 tabular-nums">{count}</span>}
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
  emitters: Emitters,
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
    return <FieldRows rows={section.rows} owner={view.classHash} />;
  }

  const Widget = WIDGETS[section.widget];
  return <Widget section={section} pages={pages} view={view} />;
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
