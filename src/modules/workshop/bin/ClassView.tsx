import { CaretRightIcon } from "@phosphor-icons/react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Checkbox, ContextMenu, Readout } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import { BinContextMenu } from "./BinContextMenu";
import { nameHash } from "./binHash";
import { RowValue } from "./BinRow";
import { rowKey, type RowLine } from "./binRows";
import { BinTree } from "./BinTree";
import {
  Cell,
  elementsOf,
  FieldRow,
  fieldsIn,
  type FieldsOf,
  fieldsOf,
  type LayoutPages,
  None,
  TableRows,
  TextCell,
  TextureTile,
  type ViewContext,
  type WidgetProps,
} from "./ClassCells";
import {
  type ClassLayout,
  levelRequests,
  NAMED,
  type PlacedSection,
  placeRows,
  readsOwnMarks,
  SAMPLER,
  type SectionWidget,
} from "./classLayouts";
import { EffectTable, IconRow, MeshCard, OverrideTable } from "./SkinSections";
import { useBinRead } from "./useBinRead";
import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "./useLinkTargets";
import { useValueMarks, ValueMarksContext } from "./useValueMarks";
import { Emitters } from "./VfxSections";

/** The most rows a tree section shows before it scrolls, so no section owns the page. */
const TREE_ROWS = 12;

/** The room a mode field takes, so a column of them lines its digits up. */
const MODE_WIDTH = "w-8";

const NO_PAGES: LayoutPages = new Map();

interface ClassViewProps {
  /** The open's id, which every read carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  /** The object's properties at depth zero, which the open already answered. */
  roots: readonly BinRow[];
  /** The class the roots are properties of, which the layout was keyed on. */
  classHash: string;
  layout: ClassLayout;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  onNotOpen: () => void;
  /** Switch the tab to Properties and reveal the cell's row there. */
  onShowInProperties: (key: string) => void;
}

/**
 * One object drawn as its class's layout, beside the tree. "Class views" in
 * docs/ux/BIN_EDITOR.md.
 *
 * Every cell is a path and a value, the pair a row carries, so the layout holds no
 * state of its own and its menu is the row's.
 */
export function ClassView({
  document,
  asset,
  roots,
  classHash,
  layout,
  objectName,
  onNotOpen,
  onShowInProperties,
}: ClassViewProps) {
  const placed = useMemo(() => placeRows(roots, layout), [roots, layout]);
  const pages = useLayoutRead(document, placed);
  const view = useMemo<ViewContext>(
    () => ({ document, asset, classHash, objectName, onNotOpen }),
    [document, asset, classHash, objectName, onNotOpen],
  );

  /* The roots and everything the read answered, each checked as one group. A tree
     section runs its own checks, because it is a tree. */
  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...[...pages].map(([key, page]) => ({ key, rows: page.rows })),
    ],
    [roots, pages],
  );
  const linkTargets = useCheckLinkTargets(document, groups);
  const linkOpen = useWarmLinkOpen(linkTargets);

  const held = useMemo(() => cellRows(placed, pages), [placed, pages]);
  const marks = useValueMarks(document, held.marks);
  const [menuLine, setMenuLine] = useState<RowLine | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]");
    const row = cell?.dataset.rowKey === undefined ? undefined : held.menu.get(cell.dataset.rowKey);
    setMenuLine(row === undefined ? null : cellLine(row, classHash));
  }

  return (
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <LinkOpenContext value={linkOpen}>
          <ValueMarksContext value={marks}>
            <ContextMenu.Root>
              <ContextMenu.Trigger
                data-ui="ClassView"
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 scrollbar-md select-none"
                onContextMenu={handleContextMenu}
              >
                {placed.map((section, at) => (
                  <Section key={at} section={section} pages={pages} view={view} />
                ))}
              </ContextMenu.Trigger>

              <BinContextMenu
                line={menuLine}
                objectName={objectName}
                onShowInProperties={onShowInProperties}
              />
            </ContextMenu.Root>
          </ValueMarksContext>
        </LinkOpenContext>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}

/**
 * The levels a layout's widgets read, through the projected read.
 *
 * "What a layout reads" in docs/ux/BIN_EDITOR.md. The depth-zero rows arrive with the
 * open, so a material costs the containers and then their elements, two calls. A level
 * asks out of what the levels above it answered, and a tree section reads nothing until
 * a reader expands it.
 */
function useLayoutRead(document: BinDocumentId, placed: readonly PlacedSection[]): LayoutPages {
  const first = useBinRead(
    document,
    useMemo(() => levelRequests(placed, NO_PAGES, 0), [placed]),
  );
  const second = useBinRead(
    document,
    useMemo(() => levelRequests(placed, first, 1), [placed, first]),
  );
  const above = useMemo(() => joined(first, second), [first, second]);
  const third = useBinRead(
    document,
    useMemo(() => levelRequests(placed, above, 2), [placed, above]),
  );
  return useMemo(() => joined(above, third), [above, third]);
}

/** Two levels' answers as one map, which is how a level reads what the ones above it got. */
function joined(above: LayoutPages, level: LayoutPages): LayoutPages {
  if (level.size === 0) return above;
  return new Map([...above, ...level]);
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
  "sampler-table": SamplerTable,
  "param-table": ParamTable,
  "switch-list": SwitchList,
  fields: NamedFields,
  icons: IconRow,
  mesh: MeshCard,
  "override-table": OverrideTable,
  "effect-table": EffectTable,
  emitters: Emitters,
};

function SectionBody({ section, pages, view, title }: SectionProps & { title: string }) {
  if (section.widget === "tree") {
    return (
      <div className="flex flex-col rounded-md border border-surface-700/50">
        <BinTree
          document={view.document}
          asset={view.asset}
          roots={section.rows}
          rootOwner={view.classHash}
          label={title}
          maxRows={TREE_ROWS}
          initialExpanded={section.other ? undefined : section.rows.map(rowKey)}
          objectName={view.objectName}
          onNotOpen={view.onNotOpen}
        />
      </div>
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

/** A row per element, each drawn from the fields the level under it answered. */
function ElementTable({
  section,
  pages,
  draw,
}: WidgetProps & { draw: (fields: FieldsOf) => ReactNode }) {
  return (
    <TableRows rows={elementsOf(section.rows, pages)}>
      {(element) => draw(fieldsOf(pages.get(rowKey(element))))}
    </TableRows>
  );
}

function SamplerTable(props: WidgetProps) {
  return <ElementTable {...props} draw={(fields) => <Sampler fields={fields} />} />;
}

function ParamTable(props: WidgetProps) {
  return <ElementTable {...props} draw={(fields) => <Param fields={fields} />} />;
}

function SwitchList(props: WidgetProps) {
  return <ElementTable {...props} draw={(fields) => <Switch fields={fields} />} />;
}

/** The sampler's texture as a tile, its name, its path as a chip, and its modes. */
function Sampler({ fields }: { fields: FieldsOf }) {
  const texture = fields(SAMPLER.texturePath);
  const named = fields(SAMPLER.textureName) ?? fields(SAMPLER.samplerName);

  return (
    <>
      <TextureTile row={texture} />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* DS-WEIGHT-TIER */}
        <TextCell row={named} className="font-medium text-surface-100" />
        <Cell row={texture} className="flex min-w-0 items-center gap-2">
          {texture && <RowValue row={texture} />}
        </Cell>
      </span>
      <Modes fields={fields} />
    </>
  );
}

/** The sampler's address and filter modes, each under its field's own letter. */
function Modes({ fields }: { fields: FieldsOf }) {
  const modes: [label: string, hash: string][] = [
    ["U", SAMPLER.addressU],
    ["V", SAMPLER.addressV],
    ["W", SAMPLER.addressW],
    ["Mag", SAMPLER.filterMag],
    ["Min", SAMPLER.filterMin],
  ];

  return (
    <span className="flex shrink-0 items-center gap-1">
      {modes.map(([label, hash]) => {
        const mode = fields(hash);
        if (mode?.value.type !== "integer") return null;
        return (
          <Cell key={label} row={mode} className="flex">
            <Readout label={label} value={mode.value.text} className={MODE_WIDTH} />
          </Cell>
        );
      })}
    </span>
  );
}

/** The param's name, and its four numbers in the field a vector row draws. */
function Param({ fields }: { fields: FieldsOf }) {
  const named = fields(NAMED.name);
  const value = fields(NAMED.value);
  return (
    <>
      <TextCell row={named} className="w-48 shrink-0 text-surface-200" />
      <Cell row={value} className="flex min-w-0 flex-1">
        {value && <RowValue row={value} />}
      </Cell>
    </>
  );
}

/** The switch's checkbox, and its name after it. */
function Switch({ fields }: { fields: FieldsOf }) {
  const on = fields(NAMED.on);
  const named = fields(NAMED.name);
  return (
    <>
      <Cell row={on} className="flex">
        <Checkbox
          size="sm"
          checked={on?.value.type === "bool" && on.value.value}
          readOnly
          tabIndex={-1}
        />
      </Cell>
      <TextCell row={named} className="min-w-0 text-surface-200" />
    </>
  );
}

/** What the view holds a row for: the menu it aims, and the marks it reads. */
interface ViewRows {
  /** Every row a cell was drawn for, by key, which is what the menu is aimed at. */
  readonly menu: ReadonlyMap<string, BinRow>;
  /** The rows the view reads a value mark for, which a widget of its own is left out of. */
  readonly marks: readonly BinRow[];
}

/** Every row the layout drew a cell for, and which of them the view marks itself. */
function cellRows(placed: readonly PlacedSection[], pages: LayoutPages): ViewRows {
  const menu = new Map<string, BinRow>();
  const marks: BinRow[] = [];

  for (const section of placed) {
    if (section.widget === "tree") continue;
    const own = readsOwnMarks(section.widget);
    for (const row of walk(section.rows, pages)) {
      menu.set(rowKey(row), row);
      if (!own) marks.push(row);
    }
  }
  return { menu, marks };
}

/** `rows` and everything the read answered under them, however deep it went. */
function walk(rows: readonly BinRow[], pages: LayoutPages): BinRow[] {
  const out: BinRow[] = [];
  for (const row of rows) {
    out.push(row);
    const page = pages.get(rowKey(row));
    if (page) out.push(...walk(page.rows, pages));
  }
  return out;
}

/** A cell as the row menu reads one. Its depth and its expansion are the tree's, not a cell's. */
function cellLine(row: BinRow, classHash: string): RowLine {
  return {
    kind: "row",
    key: rowKey(row),
    row,
    depth: 0,
    expanded: false,
    loading: false,
    owner: row.node === "property" ? classHash : null,
  };
}
