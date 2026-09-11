import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import { RowValue } from "./BinRow";
import { childCount, entryKeyHash, fieldHash, objectKey, PAGE_SIZE, rowKey } from "./binRows";
import {
  AlsoCheck,
  Cell,
  childOf,
  elementsOf,
  FieldRow,
  fieldsIn,
  fieldsOf,
  type LayoutPages,
  SectionTree,
  TableRows,
  TextCell,
  TextureTile,
  type WidgetProps,
} from "./ClassCells";
import { CENSORED_IMAGE, EFFECT, MESH } from "./classLayouts";
import { declaredElsewhere } from "./linkDecision";
import { useBinDocument } from "./useBinDocument";
import { useBinRead } from "./useBinRead";
import { useLinkTargets } from "./useLinkTargets";

/** The icons a skin carries, each as a tile under its own field's name. */
export function IconRow({ section, pages }: WidgetProps) {
  return (
    <div className="flex flex-wrap gap-3">
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

/** One texture at tile size, named under it, which is how an icon and a map draw. */
function Tile({ name, row }: { name: string; row: BinRow | undefined }) {
  return (
    <span className="flex flex-col items-center gap-1" data-row-key={row && rowKey(row)}>
      <TextureTile row={row} />
      <span className="max-w-24 truncate text-meta text-surface-400">{name}</span>
    </span>
  );
}

/** The five textures the mesh names, in the order a modder reads them. */
const MESH_TEXTURES = [
  MESH.texture,
  MESH.emissive,
  MESH.normalMap,
  MESH.gloss,
  MESH.roughness,
] as const;

/** The three fields that name what the mesh is built out of. */
const MESH_FIELDS = [MESH.simpleSkin, MESH.skeleton, MESH.material] as const;

/** The mesh: what it is built out of, and its textures. */
export function MeshCard({ section, pages }: WidgetProps) {
  const byField = fieldsIn(elementsOf(section.rows, pages));
  const named = MESH_FIELDS.map(byField).filter((row): row is BinRow => row !== undefined);
  const textures = MESH_TEXTURES.map(byField).filter((row): row is BinRow => row !== undefined);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        {named.map((row) => (
          <FieldRow key={rowKey(row)} row={row} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {textures.map((row) => (
          <Tile key={rowKey(row)} name={row.name} row={row} />
        ))}
      </div>
    </div>
  );
}

/** One row per material override the mesh carries, as the tree draws them. */
export function OverrideRows({ section, pages, view }: WidgetProps) {
  const lists = section.rows
    .map((row) => childOf(pages, row, MESH.override))
    .filter((row): row is BinRow => row !== undefined);

  return (
    <SectionTree
      view={view}
      roots={elementsOf(lists, pages)}
      rootOwner={null}
      label={section.title()}
    />
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
 * The system an effect's key names, drawn as the resolver's own link row.
 *
 * A key the map does not answer for keeps its own hash, which is what the tree draws.
 */
function Resource({
  effect,
  resources,
}: {
  effect: BinRow | undefined;
  resources: ReadonlyMap<string, BinRow>;
}) {
  const system = effect?.value.type === "hash" ? resources.get(effect.value.hash) : undefined;
  if (system !== undefined) return <RowValue row={system} />;
  if (effect === undefined) return null;
  return <RowValue row={effect} />;
}

/** A row per effect: the system its key resolves to, its name, and the bone it sits on. */
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
        return (
          <>
            <Cell row={key} className="flex min-w-0 flex-1 items-center gap-2">
              <Resource effect={key} resources={resources} />
            </Cell>
            <TextCell row={fields(EFFECT.bone)} className="w-48 shrink-0 text-surface-400" />
          </>
        );
      }}
    </TableRows>
  );
}
