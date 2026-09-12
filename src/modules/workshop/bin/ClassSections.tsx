import { CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { rowKey } from "./binRows";
import {
  elementsOf,
  FieldRow,
  fieldsIn,
  type LayoutPages,
  None,
  SectionTree,
  type ViewContext,
  type WidgetProps,
} from "./ClassCells";
import type { PlacedSection, SectionWidget } from "./classLayouts";
import { EffectTable, IconRow, MeshCard, OverrideRows } from "./SkinSections";
import { Emitters } from "./VfxSections";

/** Every placed section, in the order the layout named them. */
export function Sections({
  placed,
  pages,
  view,
}: {
  placed: readonly PlacedSection[];
  pages: LayoutPages;
  view: ViewContext;
}) {
  return placed.map((section, at) => (
    <Section key={at} section={section} pages={pages} view={view} />
  ));
}

interface SectionProps {
  section: PlacedSection;
  pages: LayoutPages;
  view: ViewContext;
}

/** One section: its header, and the fields it placed. */
function Section({ section, pages, view }: SectionProps) {
  const [open, setOpen] = useState(true);
  const title = section.title();

  return (
    <section data-ui="ClassView:section" className="flex flex-col gap-1">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-left text-surface-400 hover:text-surface-200"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
        <span className="text-xs font-medium tracking-wide uppercase">{title}</span>
      </button>
      {open && section.rows.length === 0 && (
        <span className="pl-3 text-meta text-surface-400">
          {m.workshop_bin_section_none_empty()}
        </span>
      )}
      {open && section.rows.length > 0 && (
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
        initialExpanded={section.other ? undefined : section.rows.map(rowKey)}
      />
    );
  }

  if (section.widget === undefined) {
    return (
      <div className="flex flex-col">
        {section.rows.map((row) => (
          <FieldRow key={rowKey(row)} row={row} />
        ))}
      </div>
    );
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

  if (drawn.length === 0) return <None />;
  return (
    <div className="flex flex-col">
      {drawn.map((row) => (
        <FieldRow key={rowKey(row)} row={row} />
      ))}
    </div>
  );
}

/** One row per element of the containers the section placed, as the tree draws them. */
function ElementRows({ section, pages, view }: WidgetProps) {
  return (
    <SectionTree
      view={view}
      roots={elementsOf(section.rows, pages)}
      rootOwner={null}
      label={section.title()}
    />
  );
}
