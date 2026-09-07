import { CaretRightIcon } from "@phosphor-icons/react";
import { type MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Checkbox, ContextMenu, Readout } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow, BinRows } from "@/lib/tauri";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { OpenIntent } from "../palette/types";
import { useOpenDocumentAs } from "../state";
import { BinContextMenu } from "./BinContextMenu";
import { RowValue } from "./BinRow";
import { childCount, fieldHash, rowKey, type RowLine } from "./binRows";
import { BinTree } from "./BinTree";
import { type ClassLayout, NAMED, type PlacedSection, placeRows, SAMPLER } from "./classLayouts";
import { chunkPath, decideFileLink } from "./linkDecision";
import { TextureSwatch } from "./TextureSwatch";
import { type ReadRequest, useBinRead } from "./useBinRead";
import {
  LinkAssetContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useLayerCopy,
  useLinkTargets,
} from "./useLinkTargets";

/** The most rows a tree section shows before it scrolls, so no section owns the page. */
const TREE_ROWS = 12;

/** The room a mode field takes, so a column of them lines its digits up. */
const MODE_WIDTH = "w-12";

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
  const read = useLayoutRead(document, placed);

  /* The roots and everything the read answered, each checked as one group. A tree
     section runs its own checks, because it is a tree. */
  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...[...read.elements].map(([key, page]) => ({ key, rows: page.rows })),
      ...[...read.fields].map(([key, page]) => ({ key, rows: page.rows })),
    ],
    [roots, read],
  );
  const linkTargets = useCheckLinkTargets(document, groups);

  /* One menu for the whole view, pointed at the cell the event came from. */
  const byKey = useMemo(() => cellRows(placed, read), [placed, read]);
  const [menuLine, setMenuLine] = useState<RowLine | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]");
    const row = cell?.dataset.rowKey === undefined ? undefined : byKey.get(cell.dataset.rowKey);
    setMenuLine(row === undefined ? null : cellLine(row, classHash));
  }

  return (
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <ContextMenu.Root>
          <ContextMenu.Trigger
            data-ui="ClassView"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 select-none"
            onContextMenu={handleContextMenu}
          >
            {placed.map((section, at) => (
              <Section
                key={at}
                section={section}
                read={read}
                document={document}
                asset={asset}
                classHash={classHash}
                objectName={objectName}
                onNotOpen={onNotOpen}
              />
            ))}
          </ContextMenu.Trigger>

          <BinContextMenu
            line={menuLine}
            objectName={objectName}
            onShowInProperties={onShowInProperties}
          />
        </ContextMenu.Root>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}

/** What the layout read under its table sections: their elements, and each element's fields. */
interface LayoutRead {
  /** The rows under a section's field, by that field row's key. */
  readonly elements: ReadonlyMap<string, BinRows>;
  /** The rows under one element, by that element row's key. */
  readonly fields: ReadonlyMap<string, BinRows>;
}

/**
 * The two levels a layout's tables read, through the projected read.
 *
 * "What a layout reads" in docs/ux/BIN_EDITOR.md. The depth-zero rows arrive with the
 * open, so a material costs the containers and then their elements, two calls. A tree
 * section reads nothing until a reader expands it.
 */
function useLayoutRead(document: BinDocumentId, placed: readonly PlacedSection[]): LayoutRead {
  const wanted = useMemo<ReadRequest[]>(() => {
    const requests: ReadRequest[] = [];
    for (const section of placed) {
      if (section.widget === undefined || section.widget === "tree") continue;
      for (const row of section.rows) {
        requests.push({ key: rowKey(row), rows: childCount(row) });
      }
    }
    return requests;
  }, [placed]);
  const elements = useBinRead(document, wanted);

  const under = useMemo<ReadRequest[]>(() => {
    const requests: ReadRequest[] = [];
    for (const page of elements.values()) {
      for (const row of page.rows) {
        if (row.value.type !== "struct") continue;
        requests.push({ key: rowKey(row), rows: row.value.len });
      }
    }
    return requests;
  }, [elements]);
  const fields = useBinRead(document, under);

  return useMemo(() => ({ elements, fields }), [elements, fields]);
}

interface SectionProps {
  section: PlacedSection;
  read: LayoutRead;
  document: BinDocumentId;
  asset: AssetRef;
  classHash: string;
  objectName: (entry: string) => string;
  onNotOpen: () => void;
}

/**
 * One section: its header, and the fields it placed.
 *
 * An empty section keeps its header over a muted None, so a reader tells an empty list
 * from a field the class lacks and every object of one class has one section order.
 */
function Section({ section, read, ...rest }: SectionProps) {
  const [open, setOpen] = useState(true);
  const title = section.title();

  return (
    <section data-ui="ClassView:section" className="flex flex-col gap-2">
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
        <span className="pl-4 text-row text-surface-400">
          {m.workshop_bin_section_none_empty()}
        </span>
      )}
      {open && section.rows.length > 0 && (
        <div className="pl-4">
          <SectionBody section={section} read={read} title={title} {...rest} />
        </div>
      )}
    </section>
  );
}

type SectionBodyProps = Omit<SectionProps, "section"> & {
  section: PlacedSection;
  title: string;
};

function SectionBody({
  section,
  read,
  document,
  asset,
  classHash,
  objectName,
  onNotOpen,
  title,
}: SectionBodyProps) {
  if (section.widget === "tree") {
    return (
      <div className="flex flex-col rounded-lg border border-surface-700/50">
        <BinTree
          document={document}
          asset={asset}
          roots={section.rows}
          rootOwner={classHash}
          label={title}
          maxRows={TREE_ROWS}
          /* A named section opens what it names. Other stays shut, as in Properties. */
          initialExpanded={section.other ? undefined : section.rows.map(rowKey)}
          objectName={objectName}
          onNotOpen={onNotOpen}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {section.rows.map((row) => (
        <Placed key={rowKey(row)} row={row} widget={section.widget} read={read} />
      ))}
    </div>
  );
}

interface PlacedProps {
  row: BinRow;
  widget: PlacedSection["widget"];
  read: LayoutRead;
}

/** One placed field: the widget its section names, or the cell the row itself draws. */
function Placed({ row, widget, read }: PlacedProps) {
  const elements = read.elements.get(rowKey(row))?.rows ?? [];

  if (widget === "sampler-table") {
    return <Table rows={elements} read={read} draw={(fields) => <Sampler fields={fields} />} />;
  }
  if (widget === "param-table") {
    return <Table rows={elements} read={read} draw={(fields) => <Param fields={fields} />} />;
  }
  if (widget === "switch-list") {
    return <Table rows={elements} read={read} draw={(fields) => <Switch fields={fields} />} />;
  }

  return (
    <div className="flex min-h-6 items-center gap-3" data-row-key={rowKey(row)}>
      <span className="w-40 shrink-0 truncate text-row text-surface-200">{row.name}</span>
      <RowValue row={row} />
    </div>
  );
}

interface TableProps {
  rows: readonly BinRow[];
  read: LayoutRead;
  draw: (fields: FieldsOf) => React.ReactNode;
}

/** A row per element, each drawn from the fields the second level answered for it. */
function Table({ rows, read, draw }: TableProps) {
  if (rows.length === 0) {
    return <span className="text-row text-surface-400">{m.workshop_bin_section_none_empty()}</span>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((element) => (
        <div
          key={rowKey(element)}
          data-row-key={rowKey(element)}
          /* DS-VEIL, DS-RADIUS */
          className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-veil"
        >
          {draw(fieldsOf(read.fields.get(rowKey(element))))}
        </div>
      ))}
    </div>
  );
}

/** One element's fields, by field hash, as the read answered them. */
type FieldsOf = (hash: string) => BinRow | undefined;

function fieldsOf(page: BinRows | undefined): FieldsOf {
  const byField = new Map((page?.rows ?? []).map((row) => [fieldHash(row.path), row]));
  return (hash) => byField.get(hash);
}

/** The sampler's texture as a tile, its name, its path as a chip, and its modes. */
function Sampler({ fields }: { fields: FieldsOf }) {
  const texture = fields(SAMPLER.texturePath);
  const named = fields(SAMPLER.textureName) ?? fields(SAMPLER.samplerName);

  return (
    <>
      <TextureTile row={texture} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Cell row={named} className="truncate text-row text-surface-100">
          {textOf(named)}
        </Cell>
        <Cell row={texture} className="flex min-w-0 items-center gap-3">
          {texture && <RowValue row={texture} />}
        </Cell>
      </span>
      <Modes fields={fields} />
    </>
  );
}

/**
 * The sampler's address and filter modes, each under its field's own letter.
 *
 * The schema declares them as `u32` and names no constants, so the numbers are what a
 * reader gets until something does.
 */
function Modes({ fields }: { fields: FieldsOf }) {
  const modes: [label: string, hash: string][] = [
    ["U", SAMPLER.addressU],
    ["V", SAMPLER.addressV],
    ["W", SAMPLER.addressW],
    ["Mag", SAMPLER.filterMag],
    ["Min", SAMPLER.filterMin],
  ];

  return (
    <span className="flex shrink-0 items-center gap-1.5">
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
      <Cell row={named} className="w-56 shrink-0 truncate text-row text-surface-100">
        {textOf(named)}
      </Cell>
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
      <Cell row={named} className="min-w-0 truncate text-row text-surface-100">
        {textOf(named)}
      </Cell>
    </>
  );
}

/**
 * One cell of a table, tagged with the row it draws.
 *
 * The tag is what the view's one menu is aimed at, so a right-click on a sampler's
 * path offers that path's own actions rather than the element's.
 */
function Cell({
  row,
  className,
  children,
}: {
  row: BinRow | undefined;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={className} data-row-key={row === undefined ? undefined : rowKey(row)}>
      {children}
    </span>
  );
}

/**
 * The sampler's texture at 48px, for a `file` and for a string that resolves.
 *
 * A path neither side holds, and one naming something that is not a texture, draws the
 * empty tile: the table's rows keep one left edge whatever each sampler points at.
 */
function TextureTile({ row }: { row: BinRow | undefined }) {
  const targets = useLinkTargets();
  const path = texturePath(row);
  const layer = useLayerCopy(path);
  const open = useOpenDocumentAs();
  const decision = decideFileLink(path, targets, layer);

  const fileKind = path === null ? "unknown" : fileKindFromPath(path);
  if (decision.kind !== "chip" || path === null || !isTexture(fileKind)) return <EmptyTile />;
  return (
    <TextureSwatch
      asset={decision.document.asset}
      path={path}
      fileKind={fileKind}
      layerTitle={layer?.title}
      size="tile"
      onOpen={(intent: OpenIntent) => open(decision.document, intent)}
    />
  );
}

function EmptyTile() {
  return (
    /* DS-VEIL, DS-RADIUS */
    <span
      className="h-12 w-12 shrink-0 rounded-sm border border-surface-veil-strong bg-surface-veil-soft"
      aria-hidden
    />
  );
}

/** The chunk path a texture field names, whether it crosses as a `file` or as a string. */
function texturePath(row: BinRow | undefined): string | null {
  if (row?.value.type === "wadChunkLink") return row.value.path;
  if (row?.value.type === "string") return chunkPath(row.value.value);
  return null;
}

function isTexture(kind: ReturnType<typeof fileKindFromPath>): boolean {
  return kind === "texture" || kind === "texture_dds";
}

/** A field's value where it is a string, which is what a table's name column draws. */
function textOf(row: BinRow | undefined): string | undefined {
  return row?.value.type === "string" ? row.value.value : undefined;
}

/** Every row a cell was drawn for, by key, which is what the menu is aimed at. */
function cellRows(placed: readonly PlacedSection[], read: LayoutRead): ReadonlyMap<string, BinRow> {
  const rows = new Map<string, BinRow>();
  for (const section of placed) {
    if (section.widget === "tree") continue;
    for (const row of section.rows) {
      rows.set(rowKey(row), row);
      for (const element of read.elements.get(rowKey(row))?.rows ?? []) {
        rows.set(rowKey(element), element);
        for (const field of read.fields.get(rowKey(element))?.rows ?? []) {
          rows.set(rowKey(field), field);
        }
      }
    }
  }
  return rows;
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
