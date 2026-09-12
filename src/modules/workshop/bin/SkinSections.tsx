import { ArrowRightIcon } from "@phosphor-icons/react";
import { use, useEffect, useRef, useState } from "react";

import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { nameHash } from "./binHash";
import { RowValue } from "./BinRow";
import { childCount, entryKeyHash, fieldHash, objectKey, PAGE_SIZE, rowKey } from "./binRows";
import { ClassCard } from "./ClassCard";
import {
  AlsoCheck,
  Cell,
  childOf,
  elementsOf,
  FieldRows,
  fieldsIn,
  fieldsOf,
  FoldCaret,
  type LayoutPages,
  None,
  TableRows,
  TextCell,
  textOf,
  TextureTile,
  type WidgetProps,
} from "./ClassCells";
import { CENSORED_IMAGE, EFFECT, MESH } from "./classLayouts";
import { ObjectChip } from "./LinkChip";
import { declaredElsewhere } from "./linkDecision";
import { sameSubmesh, SkinChoiceContext } from "./skin/skinChoice";
import { useBinDocument } from "./useBinDocument";
import { useBinRead } from "./useBinRead";
import { useLinkTargets } from "./useLinkTargets";

/** The icons a skin carries, each as a tile under its own field's name. */
export function IconRow({ section, pages }: WidgetProps) {
  return (
    <div className="flex flex-wrap gap-3 px-1.5">
      {section.rows.map((row) => (
        <Tile key={rowKey(row)} name={row.name} row={iconChunk(row, pages)} />
      ))}
    </div>
  );
}

/**
 * The row holding the icon's chunk: the field itself, or the one under it.
 *
 * An `iconAvatar` is a `file`. An `iconCircle` holds one in an option, and a
 * `loadscreen` holds one under `image` beside the uncensored map.
 */
function iconChunk(row: BinRow, pages: LayoutPages): BinRow | undefined {
  if (row.value.type === "wadChunkLink") return row;
  const image = childOf(pages, row, CENSORED_IMAGE);
  if (image !== undefined) return image;
  return pages.get(rowKey(row))?.rows.find((child) => child.value.type === "wadChunkLink");
}

/** One texture at tile size, named under it, which is how an icon draws. */
function Tile({ name, row }: { name: string; row: BinRow | undefined }) {
  return (
    <span className="flex flex-col items-center gap-1" data-row-key={row && rowKey(row)}>
      <TextureTile row={row} />
      <span className="max-w-24 truncate text-meta text-surface-400">{name}</span>
    </span>
  );
}

/** The mesh's fields in the order a modder reads them: its files, its textures, its material. */
const MESH_FIELDS = [
  MESH.simpleSkin,
  MESH.skeleton,
  MESH.texture,
  MESH.emissive,
  MESH.normalMap,
  MESH.gloss,
  MESH.roughness,
  MESH.material,
] as const;

/** The mesh: what it is built out of and its textures, each a field row. */
export function MeshCard({ section, pages }: WidgetProps) {
  const byField = fieldsIn(elementsOf(section.rows, pages));
  const drawn = MESH_FIELDS.map(byField).filter((row): row is BinRow => row !== undefined);

  return <FieldRows rows={drawn} owner={structClass(section.rows[0])} />;
}

/** The class a struct row holds, which its fields are read on. */
function structClass(row: BinRow | undefined): string | null {
  return row?.value.type === "struct" ? row.value.classHash : null;
}

const NO_ROWS: readonly BinRow[] = [];

/** One group per material override the mesh carries, each titled by the submesh it dresses. */
export function OverrideRows({ section, pages }: WidgetProps) {
  const lists = section.rows
    .map((row) => childOf(pages, row, MESH.override))
    .filter((row): row is BinRow => row !== undefined);
  const overrides = elementsOf(lists, pages);

  if (overrides.length === 0) return <None />;
  return (
    <div className="flex flex-col gap-0.5">
      {overrides.map((element) => (
        <Override
          key={rowKey(element)}
          element={element}
          fields={pages.get(rowKey(element))?.rows ?? NO_ROWS}
        />
      ))}
    </div>
  );
}

/**
 * One override: its index and submesh over its own field rows.
 *
 * The group and the character's submesh point at each other through the skin choice,
 * per "The skin's preview" in docs/ux/BIN_EDITOR.md.
 */
function Override({ element, fields }: { element: BinRow; fields: readonly BinRow[] }) {
  const choice = use(SkinChoiceContext);
  const [open, setOpen] = useState(true);
  const submesh = textOf(fieldsIn(fields)(MESH.submesh)) ?? null;
  const pointed = sameSubmesh(choice?.submesh ?? null, submesh);
  const root = useRef<HTMLDivElement>(null);

  const picks = choice?.picks ?? 0;
  const seen = useRef(picks);
  useEffect(() => {
    if (picks === seen.current) return;
    seen.current = picks;
    if (pointed) root.current?.scrollIntoView?.({ block: "nearest" });
  }, [picks, pointed]);

  return (
    <div
      ref={root}
      data-ui="OverrideRows:override"
      /* DS-RADIUS */
      className={twMerge("flex flex-col gap-0.5 rounded-sm", pointed && "bg-accent-500/10")}
      onPointerEnter={() => submesh !== null && choice?.setSubmesh(submesh)}
      onPointerLeave={() => pointed && choice?.setSubmesh(null)}
    >
      {/* DS-VEIL, DS-RADIUS */}
      <div
        data-row-key={rowKey(element)}
        className="flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FoldCaret open={open} onToggle={() => setOpen((shown) => !shown)} />
          <span className="shrink-0 text-surface-400">{element.name}</span>
          {submesh !== null && (
            <span className="min-w-0 truncate font-medium text-surface-100 select-text">
              {submesh}
            </span>
          )}
          {submesh === null && element.value.type === "struct" && (
            <ClassCard classHash={element.value.classHash} name={element.value.class} />
          )}
        </span>
      </div>
      {open && <FieldRows rows={fields} owner={structClass(element)} depth={1} />}
    </div>
  );
}

/**
 * The idle effects, each joined to the system its key names through the resolver.
 *
 * "The skin view" in docs/research/bin-editor-higher-order-views.md. The resolver is a
 * link, so its object is read through this file's own handle where the file declares
 * it, and through a second one where another file does.
 */
export function EffectTable({ section, pages, view }: WidgetProps) {
  const effects = elementsOf(
    section.rows.filter((row) => fieldHash(row.path) !== EFFECT.resolver),
    pages,
  );
  const resolver = section.rows.find((row) => fieldHash(row.path) === EFFECT.resolver);
  const elsewhere = useResolverAsset(resolver, view.asset);
  const entry = resolver?.value.type === "objectLink" ? resolver.value.hash : null;

  if (elsewhere !== null && entry !== null) {
    return <ForeignResolver asset={elsewhere} entry={entry} effects={effects} pages={pages} />;
  }
  return <Resolved document={view.document} entry={entry} effects={effects} pages={pages} />;
}

/** The asset declaring the resolver, where another file declares it. Null where this one does. */
function useResolverAsset(resolver: BinRow | undefined, asset: AssetRef): AssetRef | null {
  const targets = useLinkTargets();
  if (resolver?.value.type !== "objectLink") return null;
  return declaredElsewhere(resolver.value.hash, targets, asset);
}

interface ResolvedProps {
  document: BinDocumentId;
  /** The resolver's object hash, or null where the skin names none. */
  entry: string | null;
  effects: readonly BinRow[];
  pages: LayoutPages;
}

/** The effects drawn against a resolver held open as `document`. */
function Resolved({ document, entry, effects, pages }: ResolvedProps) {
  const { rows, key } = useResourceMap(document, entry);
  const resources = new Map<string, BinRow>();
  for (const row of rows) {
    const hash = entryKeyHash(row);
    if (hash !== null) resources.set(hash, row);
  }

  const table = <EffectRows effects={effects} pages={pages} resources={resources} />;
  if (key === null) return table;
  return (
    <AlsoCheck document={document} group={{ key, rows }}>
      {table}
    </AlsoCheck>
  );
}

interface ForeignResolverProps {
  asset: AssetRef;
  entry: string;
  effects: readonly BinRow[];
  pages: LayoutPages;
}

/** The resolver another file declares, held open beside the skin's own document. */
function ForeignResolver({ asset, entry, effects, pages }: ForeignResolverProps) {
  const { state } = useBinDocument(asset, entry);
  if (state.status !== "open") {
    return <EffectRows effects={effects} pages={pages} resources={NO_RESOURCES} />;
  }
  return (
    <Resolved document={state.handle.document} entry={entry} effects={effects} pages={pages} />
  );
}

const NO_RESOURCES: ReadonlyMap<string, BinRow> = new Map();

/**
 * The entries of the resolver's `resourceMap`, and the key they were checked under.
 *
 * The object's own rows come first, because the map's row carries how many entries
 * reading it costs. A resolver the skin names none of answers nothing.
 */
function useResourceMap(
  document: BinDocumentId,
  entry: string | null,
): { rows: readonly BinRow[]; key: string | null } {
  /* The object's properties are one page, which is what reading its root costs. */
  const root = entry === null ? null : objectKey(entry);
  const roots = useBinRead(document, root === null ? [] : [{ key: root, rows: PAGE_SIZE }]);

  const map =
    root === null
      ? undefined
      : roots.get(root)?.rows.find((row) => fieldHash(row.path) === EFFECT.resourceMap);
  const key = map === undefined ? null : rowKey(map);
  const entries = useBinRead(
    document,
    map === undefined ? [] : [{ key: rowKey(map), rows: childCount(map) }],
  );

  return { rows: key === null ? [] : (entries.get(key)?.rows ?? []), key };
}

/**
 * The system an effect names, as a chip reading its last segment.
 *
 * An effect is keyed by `effectKey`, or by the hash of its `effectName` where it carries
 * no key. A name the map does not answer for draws as its text, and a key as its hash.
 * Every effect of a skin shares the folder its systems sit in, so the chip reads the name.
 */
function Resource({
  effect,
  name,
  resources,
}: {
  effect: BinRow | undefined;
  name: BinRow | undefined;
  resources: ReadonlyMap<string, BinRow>;
}) {
  const named = textOf(name);
  const hash =
    effect?.value.type === "hash"
      ? effect.value.hash
      : named === undefined
        ? null
        : nameHash(named);
  const system = hash === null ? undefined : resources.get(hash);
  if (system?.value.type === "objectLink") {
    return (
      <ObjectChip hash={system.value.hash} name={system.value.name} kind="link" reading="name" />
    );
  }
  if (system !== undefined) return <RowValue row={system} />;
  if (effect !== undefined) return <RowValue row={effect} />;
  if (named !== undefined) return <span className="truncate select-text">{named}</span>;
  return null;
}

/** A row per effect: the system it resolves to, the bone it sits on, and the bone it aims at. */
function EffectRows({
  effects,
  pages,
  resources,
}: {
  effects: readonly BinRow[];
  pages: LayoutPages;
  resources: ReadonlyMap<string, BinRow>;
}) {
  return (
    <TableRows rows={effects}>
      {(element) => {
        const fields = fieldsOf(pages.get(rowKey(element)));
        const key = fields(EFFECT.key);
        const name = fields(EFFECT.name);
        const target = fields(EFFECT.targetBone);
        return (
          <>
            <Cell row={key ?? name} className="flex min-w-0 flex-1 items-center gap-2">
              <Resource effect={key} name={name} resources={resources} />
            </Cell>
            <TextCell row={fields(EFFECT.bone)} className="w-32 shrink-0 text-surface-400" />
            {Boolean(textOf(target)) && (
              <span className="flex w-32 shrink-0 items-center gap-1 text-surface-400">
                <ArrowRightIcon aria-hidden className="h-3 w-3 shrink-0" />
                <TextCell row={target} className="min-w-0" />
              </span>
            )}
          </>
        );
      }}
    </TableRows>
  );
}
