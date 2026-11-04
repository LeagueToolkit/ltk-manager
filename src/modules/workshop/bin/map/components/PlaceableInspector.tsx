import { ArrowSquareOutIcon, CopyIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type MouseEvent, useMemo } from "react";

import { IconButton } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";

import { objectDocument } from "../../../documents/utils/contentDocument";
import { clickIntent, useOpenDocumentAs, useRevealRow } from "../../../state";
import { useBinRead } from "../../documents/hooks/useBinRead";
import { hashOf } from "../../shared/utils/binHash";
import { BinTree } from "../../tree/components/BinTree";
import { rowKey } from "../../tree/utils/binRows";
import { mapQueries } from "../api/mapQueries";
import { usePlaceableActions } from "../hooks/usePlaceableActions";
import { useMapScene } from "../state/mapScene";
import { chunkLabel, NO_FILTER, placeablePath, placedItems } from "../utils/mapOutline";
import { movesToLead, placeableMoves } from "../utils/placeableSpace";
import { TransformFields } from "./TransformFields";

/** The document a read with no `.materials.bin` open asks for, which reads nothing. */
const NO_DOCUMENT = 0 as BinDocumentId;

/** The most fields a placeable reads, past any class the maps place. */
const PLACEABLE_ROWS = 200;

/** The most rows the placeable's tree shows before it scrolls. */
const TREE_ROWS = 16;

/**
 * The placeable picked last in the outliner or the viewport, as its fields read in the map's
 * `.materials.bin`, with a button that opens its chunk's tab scrolled to it.
 *
 * When the `.materials.bin` takes edits, the fields edit in place and the header renames,
 * duplicates and deletes. Duplicate and delete act on the whole selection.
 */
export function PlaceableInspector({
  objectName,
  onNotOpen,
}: {
  objectName: (entry: string) => string;
  onNotOpen: () => void;
}) {
  const {
    materials,
    materialsAsset,
    chosen,
    selected,
    lead,
    editable,
    setRenaming,
    tool,
    setTool,
  } = useMapScene();
  const actions = usePlaceableActions();
  const outline = useQuery(mapQueries.outline(materials));
  const placed = useMemo(
    () =>
      lead === null || !selected.has(lead)
        ? null
        : (placedItems(outline.data ?? [], NO_FILTER).find((each) => each.id === lead) ?? null),
    [outline.data, lead, selected],
  );
  const holder =
    placed === null
      ? null
      : rowKey({
          entry: placed.chunk.entry,
          path: placeablePath(placed.item.key),
        });
  const requests = useMemo(
    () => (holder === null ? [] : [{ key: holder, rows: PLACEABLE_ROWS }]),
    [holder],
  );
  const pages = useBinRead(materials ?? NO_DOCUMENT, requests);
  const open = useOpenDocumentAs();
  const revealRow = useRevealRow();

  if (placed === null || materials === null || materialsAsset === null || holder === null) {
    return null;
  }
  const rows = pages.get(holder)?.rows ?? [];
  const { chunk, item } = placed;
  const tools = editable ? { current: tool, pick: setTool } : undefined;

  const showInChunk = (event: MouseEvent) => {
    const file = chosen === null ? chunk.entry : `${chosen.map}.materials.bin`;
    const document = objectDocument(
      materialsAsset,
      chunk.entry,
      chunk.name ?? chunk.entry,
      file,
      "MapPlaceableContainer",
    );
    open(document, clickIntent(event));
    revealRow(document.id, holder);
  };

  return (
    <section data-ui="PlaceableInspector" className="flex flex-col gap-1.5">
      <header className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 truncate text-row text-surface-100 select-text">{item.name}</span>
        <span className="min-w-0 shrink truncate text-meta text-surface-400">
          {chunkLabel(chunk)}
        </span>
        {selected.size > 1 && (
          <span className="shrink-0 text-meta text-surface-400">
            {m.workshop_bin_map_selection_count_label({ count: selected.size })}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          {editable && (
            <>
              <IconButton
                icon={<PencilSimpleIcon />}
                onClick={() => setRenaming(true)}
                label={m.workshop_bin_map_rename_action()}
              />
              <IconButton
                icon={<CopyIcon />}
                onClick={() => void actions.duplicate()}
                label={m.workshop_bin_map_duplicate_action()}
              />
              <IconButton
                icon={<TrashIcon />}
                onClick={() => void actions.remove()}
                label={m.workshop_bin_map_delete_action()}
              />
            </>
          )}
          <IconButton
            icon={<ArrowSquareOutIcon />}
            onClick={showInChunk}
            label={m.workshop_bin_map_placeable_open_action()}
          />
        </span>
      </header>
      <div className="px-1">
        <TransformFields
          transform={item.transform}
          disabled={!editable}
          tools={tools}
          onCommit={(next) => {
            const others = actions.selection.filter((each) => each.id !== placed.id);
            const items = [placed, ...others].map(({ id, item: each }) => ({
              id,
              transform: each.transform,
            }));
            void actions.move(placeableMoves(movesToLead(items, next)));
          }}
        />
      </div>
      {/* DS-GROUND, DS-RADIUS */}
      <div className="flex flex-col rounded-md border border-surface-700/50 bg-surface-900">
        <BinTree
          key={holder}
          document={materials}
          asset={materialsAsset}
          roots={rows}
          rootOwner={hashOf(item.class)}
          label={item.name}
          maxRows={TREE_ROWS}
          objectName={objectName}
          onNotOpen={onNotOpen}
          editable={editable}
        />
      </div>
    </section>
  );
}
