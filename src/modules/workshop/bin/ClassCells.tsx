import { WarningCircleIcon } from "@phosphor-icons/react";
import { type ReactNode, useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow, BinRows } from "@/lib/tauri";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { OpenIntent } from "../palette/types";
import { useOpenDocumentAs } from "../state";
import { RowValue } from "./BinRow";
import { fieldHash, rowKey } from "./binRows";
import type { PlacedSection } from "./classLayouts";
import { chunkPath, decideFileLink } from "./linkDecision";
import { TextureSwatch } from "./TextureSwatch";
import {
  joinDeclarations,
  type LinkTargets,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useLayerCopy,
  useLinkTargets,
} from "./useLinkTargets";

/** What the levels of a layout's read answered, by the key of the row each sits under. */
export type LayoutPages = ReadonlyMap<string, BinRows>;

/** The open a view draws, which every widget of it reads and resolves against. */
export interface ViewContext {
  /** The open's id, which every read carries. */
  readonly document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  readonly asset: AssetRef;
  /** The class the roots are properties of, which the layout was keyed on. */
  readonly classHash: string;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  readonly objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  readonly onNotOpen: () => void;
}

/** What one section's widget is given: what it placed, what the read answered, and the open. */
export interface WidgetProps {
  readonly section: PlacedSection;
  readonly pages: LayoutPages;
  readonly view: ViewContext;
}

/**
 * The enclosing checks with one more group folded in, for the chips under it.
 *
 * A view checks the rows of its own document. A widget that reads a second one checks
 * that document's rows itself, so a chip drawn out of them resolves the way every
 * other chip of the view does.
 */
export function AlsoCheck({
  document,
  group,
  children,
}: {
  document: BinDocumentId;
  group: RowGroup;
  children: ReactNode;
}) {
  const outer = useLinkTargets();
  const inner = useCheckLinkTargets(document, [group]);
  const merged = useMemo<LinkTargets>(
    () => ({
      index: inner.index ?? outer.index,
      declared: joinDeclarations(outer.declared, inner.declared),
      located: new Map([...outer.located, ...inner.located]),
      pending: outer.pending || inner.pending,
    }),
    [outer, inner],
  );

  return <LinkTargetsContext value={merged}>{children}</LinkTargetsContext>;
}

/** Every element the read answered under a section's placed rows, in the order placed. */
export function elementsOf(rows: readonly BinRow[], pages: LayoutPages): BinRow[] {
  return rows.flatMap((row) => pages.get(rowKey(row))?.rows ?? []);
}

/** The row the read answered under `row` for `field`, or undefined where it answered none. */
export function childOf(
  pages: LayoutPages,
  row: BinRow | undefined,
  field: string,
): BinRow | undefined {
  if (row === undefined) return undefined;
  return pages.get(rowKey(row))?.rows.find((child) => fieldHash(child.path) === field);
}

/** One element's fields, by field hash, as the read answered them. */
export type FieldsOf = (hash: string) => BinRow | undefined;

export function fieldsOf(page: BinRows | undefined): FieldsOf {
  return fieldsIn(page?.rows ?? []);
}

/** The same, over rows a caller already gathered out of more than one page. */
export function fieldsIn(rows: readonly BinRow[]): FieldsOf {
  const byField = new Map(rows.map((row) => [fieldHash(row.path), row]));
  return (hash) => byField.get(hash);
}

/**
 * One cell of a table, tagged with the row it draws.
 *
 * The tag is what the view's one menu is aimed at, so a right-click on a sampler's
 * path offers that path's own actions rather than the element's.
 */
export function Cell({
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

/** A cell drawing a row's own text, which came from the file and so goes on selecting. */
export function TextCell({ row, className }: { row: BinRow | undefined; className: string }) {
  return (
    <Cell row={row} className={twMerge("truncate select-text", className)}>
      {textOf(row)}
    </Cell>
  );
}

/** The line a section draws where the read answered no row for it. */
export function None() {
  return <span className="text-meta text-surface-400">{m.workshop_bin_section_none_empty()}</span>;
}

/** One row per element of the containers a section placed, drawn by the widget. */
export function TableRows({
  rows,
  children,
}: {
  rows: readonly BinRow[];
  children: (element: BinRow) => ReactNode;
}) {
  if (rows.length === 0) return <None />;
  return (
    <div className="flex flex-col">
      {rows.map((element) => (
        <div
          key={rowKey(element)}
          data-row-key={rowKey(element)}
          /* DS-VEIL, DS-RADIUS */
          className="flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil"
        >
          {children(element)}
        </div>
      ))}
    </div>
  );
}

/** One field on a line of its own: its name, and the cell its row draws. */
export function FieldRow({ row }: { row: BinRow }) {
  return (
    /* DS-VEIL, DS-RADIUS */
    <div
      className="flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil"
      data-row-key={rowKey(row)}
    >
      <span className="w-40 shrink-0 truncate text-surface-200">{row.name}</span>
      <RowValue row={row} />
    </div>
  );
}

/** How big a texture cell is drawn: a sampler's own tile, or a swatch in a table row. */
export type TileSize = "tile" | "row";

/** The room each size takes, and the mark that fits in it. */
const EMPTY_BOX: Record<TileSize, { box: string; mark: string }> = {
  tile: { box: "h-12 w-12", mark: "h-4 w-4" },
  row: { box: "h-5 w-5", mark: "h-3 w-3" },
};

/** A texture at `size`, for a `file` and for a string that resolves as one. */
export function TextureTile({ row, size = "tile" }: { row: BinRow | undefined; size?: TileSize }) {
  const targets = useLinkTargets();
  const path = texturePath(row);
  const layer = useLayerCopy(path);
  const open = useOpenDocumentAs();
  const decision = decideFileLink(path, targets, layer);

  const fileKind = path === null ? "unknown" : fileKindFromPath(path);
  if (decision.kind === "missing") return <EmptyTile size={size} missing />;
  if (decision.kind !== "chip" || path === null || !isTexture(fileKind)) {
    return <EmptyTile size={size} />;
  }
  return (
    <TextureSwatch
      asset={decision.document.asset}
      path={path}
      fileKind={fileKind}
      layerTitle={layer?.title}
      size={size}
      onOpen={(intent: OpenIntent) => open(decision.document, intent)}
    />
  );
}

/**
 * The tile a cell keeps when its texture does not draw, so one left edge holds.
 *
 * A missing chunk marks the tile. The row's own path carries what the mark means.
 */
export function EmptyTile({
  size = "tile",
  missing = false,
}: {
  size?: TileSize;
  missing?: boolean;
}) {
  return (
    <span
      /* DS-VEIL, DS-RADIUS */
      className={twMerge(
        "flex shrink-0 items-center justify-center rounded-sm border border-surface-veil-strong bg-surface-veil-soft",
        EMPTY_BOX[size].box,
        missing && "border-warning/30",
      )}
      aria-hidden
    >
      {missing && (
        <WarningCircleIcon
          weight="bold"
          className={twMerge("text-warning-text", EMPTY_BOX[size].mark)}
        />
      )}
    </span>
  );
}

/** The chunk path a texture field names, whether it crosses as a `file` or as a string. */
export function texturePath(row: BinRow | undefined): string | null {
  if (row?.value.type === "wadChunkLink") return row.value.path;
  if (row?.value.type === "string") return chunkPath(row.value.value);
  return null;
}

function isTexture(kind: ReturnType<typeof fileKindFromPath>): boolean {
  return kind === "texture" || kind === "texture_dds";
}

/** A field's value where it is a string, which is what a table's name column draws. */
export function textOf(row: BinRow | undefined): string | undefined {
  return row?.value.type === "string" ? row.value.value : undefined;
}
