import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu, Count, SearchField } from "@/components";
import { useRemeasure, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";
import { isChord } from "@/modules/keys";
import { toggledIn } from "@/utils";

import { steppedRow, useActiveRow } from "../../../shared/hooks/useActiveRow";
import { instantScroll } from "../../../shared/utils/instantScroll";
import { isCollapseAllKey } from "../../../shared/utils/treeGestures";
import { usePaneCommands } from "../../menus/state/paneCommands";
import { Notice } from "../../shared/preview/Notice";
import { ROW_HEIGHT } from "../../tree/components/BinRow";
import { isSelectAllKey } from "../canvas/canvasKeys";
import { addTargetOf } from "../engine/edit/newElement";
import { kindOf } from "../engine/model/elementKinds";
import { foldsAbove, type LayerRow, layerMatches, layerRows } from "../engine/model/layers";
import { iconThumb } from "../engine/model/sprites";
import { sceneMembers } from "../engine/model/tree";
import { variantPatched } from "../engine/model/variants";
import { useAddElement } from "../hooks/useAddElement";
import { useAtlasView } from "../hooks/useAtlasSources";
import { useDeleteElements } from "../hooks/useDeleteElements";
import { useHiddenScenes } from "../hooks/useHiddenScenes";
import {
  useAtlasPreviewActions,
  useFrameSettings,
  useHovered,
  useViewPreview,
  viewKey,
} from "../state/atlasPreview";
import { usePlacing, usePlacingActions } from "../state/placing";
import { ATLAS_COMMANDS } from "../utils/atlasCommands";
import { ElementMenu } from "./ElementMenu";
import { LayerRowView } from "./LayerRow";
import { SceneMenu } from "./SceneMenu";

const NONE: ReadonlySet<string> = new Set();

export interface LayersPaneProps {
  readonly document: BinDocumentId;
  readonly entry: string;
}

/**
 * The layers pane: the view's scenes and elements as a tree, topmost first.
 *
 * A search box over the tree narrows it to the elements whose name, path or class holds the text,
 * with every scene and group above one unfolded. An eye switches a scene against its resting
 * state in the preview (`hiddenScenesOf`) or hides an element, which the file never hears of, a
 * dot marks the scenes the file enables itself, and an effect row dims while effects are off.
 *
 * The tree is one tab stop: Up and Down walk the rows, Right opens a fold or steps into it, Left
 * closes it or steps out to its parent, Enter or Space selects the row, a scene's row every element
 * in it and its scenes, F frames it, Ctrl+F returns
 * to the box, Ctrl+A selects every element the search finds, Delete or Backspace deletes the
 * selection, and Escape lets go. A click with
 * Ctrl, Shift or Cmd adds a row to the selection, a double click frames it, and a right click
 * selects it and opens its menu, a scene's being `SceneMenu`. A pick on the canvas unfolds the tree to its row. The rows are
 * virtual, since the item shop holds two thousand elements.
 *
 * While a component is being placed, a row takes it in place of the selection: a scene's row
 * into the scene, a group's into the group, and any other element's into its scene.
 */
export function LayersPane({ document, entry }: LayersPaneProps) {
  const { tree, error, pending } = useAtlasView(document, entry);
  const key = viewKey(document, entry);
  const { selected, selection, hiddenElements } = useViewPreview(key);
  const { effects } = useFrameSettings();
  const chosen = useMemo(() => new Set(selection), [selection]);
  const hiddenScenes = useHiddenScenes(tree, key);
  const hovered = useHovered();
  const {
    toggleScene,
    toggleElement,
    select,
    toggleSelected,
    setSelection,
    setHovered,
    requestFrame,
  } = useAtlasPreviewActions();
  const placing = usePlacing(key);
  const { stop: stopPlacing } = usePlacingActions();
  const adder = useAddElement(key, tree);
  const deleter = useDeleteElements(key, tree);
  const [menuElement, setMenuElement] = useState<string | null>(null);
  const [menuScene, setMenuScene] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const matches = useMemo(() => (tree === null ? null : layerMatches(tree, query)), [tree, query]);
  const roots = useMemo(() => new Set(tree?.sceneChildren.get(null) ?? []), [tree]);
  const [open, setOpen] = useState<ReadonlySet<string>>(roots);
  useEffect(() => setOpen((held) => (held.size === 0 ? roots : held)), [roots]);
  /* The folds the reader shut under the current search, which opens every fold above a match. */
  const [shut, setShut] = useState<ReadonlySet<string>>(NONE);
  const unfolded = useMemo(
    () => (matches === null ? open : withoutAll(matches.above, shut)),
    [matches, open, shut],
  );
  const rows = useMemo(
    () => (tree === null ? [] : layerRows(tree, unfolded, matches?.kept ?? null)),
    [tree, unfolded, matches],
  );
  const patched = useMemo(() => (tree === null ? new Set<string>() : variantPatched(tree)), [tree]);

  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    scrollToFn: instantScroll,
  });
  useRemeasure(virtualizer, rowHeight);

  const { active, setActiveId, stepTo, reveal, domId, activeDescendant, isActive } = useActiveRow(
    rows,
    virtualizer,
  );

  /* A pick made on the canvas unfolds the tree to its row, then scrolls it into view once. */
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (tree === null || selected === null || selected === revealed.current) return;

    revealed.current = selected;
    reveal(`element:${selected}`);
    const above = foldsAbove(tree, selected);
    setOpen((held) =>
      above.every((each) => held.has(each)) ? held : new Set([...held, ...above]),
    );
    setShut((held) => (above.some((each) => held.has(each)) ? withoutAll(held, above) : held));
  }, [tree, selected, reveal]);

  const changeQuery = (next: string) => {
    setQuery(next);
    setShut(NONE);
  };

  const toggleOpen = (row: LayerRow) => {
    const flip = (held: ReadonlySet<string>) => toggledIn(held, row.key);
    if (matches === null) setOpen(flip);
    else setShut(flip);
  };

  /** Put the component being placed into `row`, answering whether one was being placed. */
  const putInto = (row: LayerRow) => {
    if (tree === null || placing === null) return false;

    const kind = kindOf(placing.kind);
    const target =
      row.type === "scene" ? { scene: row.key, group: null } : addTargetOf(tree, row.key);
    stopPlacing();
    if (kind !== undefined && target !== null) void adder.add(kind, target);
    return true;
  };

  const act = (row: LayerRow, additive = false) => {
    setActiveId(row.id);
    if (putInto(row)) return;

    if (row.type === "scene") selectScene(row.key, additive);
    else if (additive) toggleSelected(key, row.key);
    else select(key, row.key);
  };

  const sceneChosen = (scene: string) => {
    const members = tree === null ? [] : sceneMembers(tree, scene);
    return members.length > 0 && members.every((each) => chosen.has(each));
  };

  const selectScene = (scene: string, additive: boolean) => {
    if (tree === null) return;

    const members = sceneMembers(tree, scene);
    let next = members;
    if (additive && sceneChosen(scene)) next = selection.filter((each) => !members.includes(each));
    else if (additive) next = [...new Set([...selection, ...members])];

    /* Selecting a scene leaves its fold as it is, where a pick unfolds to its row. */
    revealed.current = next.at(-1) ?? null;
    setSelection(key, next);
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const command = event.ctrlKey || event.metaKey;
    if (isCollapseAllKey(event)) {
      event.preventDefault();
      if (matches === null) setOpen(NONE);
      else setShut(matches.above);
      return;
    }
    if (isChord(event, "atlas.findLayer")) {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
      return;
    }
    if (isSelectAllKey(event) && tree !== null) {
      event.preventDefault();
      setSelection(key, [...(matches?.matched ?? tree.elements.keys())]);
      return;
    }
    if (isChord(event, "atlas.clear") && selection.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      select(key, null);
      return;
    }
    if (command || event.altKey) return;
    if (isChord(event, "atlas.delete")) {
      event.preventDefault();
      void deleter.run(selection);
      return;
    }

    const row = rows[active];
    if (row === undefined) return;

    const page = virtualizer.getVirtualItems().length;
    const step = navigation(event.key, row, active, rows, page);
    if (step === null) return;

    event.preventDefault();
    if (step === "act") act(row);
    else if (step === "toggle") toggleOpen(row);
    else if (step === "frame") requestFrame(key, row.key);
    else stepTo(step);
  }

  const activeRow = rows[active];
  const paneFocus = usePaneCommands("atlas.layers", {
    [ATLAS_COMMANDS.frame]: {
      run: activeRow?.type === "element" ? () => requestFrame(key, activeRow.key) : null,
      reason: m.workshop_bin_menu_atlas_frame_layer_reason(),
      title: m.workshop_bin_menu_atlas_frame_layer_action(),
    },
    [ATLAS_COMMANDS.delete]: {
      run: deleter.available && selection.length > 0 ? () => void deleter.run(selection) : null,
      reason: deleter.available ? m.workshop_bin_menu_atlas_selection_reason() : undefined,
    },
    [ATLAS_COMMANDS.selectAll]: {
      run:
        tree === null
          ? null
          : () => setSelection(key, [...(matches?.matched ?? tree.elements.keys())]),
      title: matches === null ? undefined : m.workshop_bin_menu_atlas_select_matches_action(),
    },
  });

  if (error !== null) return <Notice text={m.workshop_bin_atlas_view_error()} />;
  if (pending || tree === null) return <Notice text={m.workshop_bin_atlas_view_pending()} />;
  if (tree.elements.size === 0 && tree.scenes.size === 0) {
    return <Notice text={m.workshop_bin_atlas_layers_empty()} />;
  }

  return (
    <div data-ui="LayersPane" className="flex min-h-0 flex-1 flex-col select-none" {...paneFocus}>
      <div className="flex shrink-0 items-center gap-1.5 p-1.5 pb-1">
        <SearchField
          value={query}
          onChange={changeQuery}
          label={m.workshop_bin_atlas_layers_search_label()}
          clearLabel={m.workshop_bin_atlas_layers_search_clear_action()}
          onCommit={() => scroller.current?.focus()}
          inputRef={search}
        >
          {matches !== null && <Count>{matches.matched.size}</Count>}
        </SearchField>
      </div>
      {rows.length === 0 && <Notice text={m.workshop_bin_atlas_layers_no_match_empty()} />}
      <ContextMenu.Root>
        <ContextMenu.Trigger
          ref={scroller}
          data-ui="LayersPane:tree"
          role="tree"
          tabIndex={0}
          aria-label={m.workshop_bin_pane_layers_label()}
          aria-activedescendant={activeDescendant}
          /* DS-SCROLLBAR */
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 text-row outline-none scrollbar-md"
          onKeyDown={handleKeyDown}
          onPointerLeave={() => setHovered(null)}
          onContextMenuCapture={() => {
            setMenuElement(null);
            setMenuScene(null);
          }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index];
              if (row === undefined) return null;

              return (
                <div
                  key={virtual.key}
                  className="absolute left-0 w-full"
                  style={{ top: virtual.start, height: virtual.size }}
                  onPointerUp={() => {
                    if (placing?.dragged === true) putInto(row);
                  }}
                >
                  <LayerRowView
                    domId={domId(virtual.index)}
                    row={row}
                    query={query}
                    thumb={row.type === "element" ? iconThumb(tree, row.key) : null}
                    hidden={
                      row.type === "scene" ? hiddenScenes.has(row.key) : hiddenElements.has(row.key)
                    }
                    dimmed={
                      row.type === "element" &&
                      !effects &&
                      (row.kind === "effect" || row.kind === "particle")
                    }
                    patched={row.type === "element" && patched.has(row.key)}
                    selected={row.type === "scene" ? sceneChosen(row.key) : chosen.has(row.key)}
                    hovered={row.type === "element" && row.key === hovered}
                    active={isActive(virtual.index)}
                    onFold={() => toggleOpen(row)}
                    onActivate={(additive) => act(row, additive)}
                    onHover={() => setHovered(row.type === "element" ? row.key : null)}
                    onHide={() =>
                      row.type === "scene" ? toggleScene(key, row.key) : toggleElement(key, row.key)
                    }
                    onFrame={() => {
                      if (row.type === "element") requestFrame(key, row.key);
                    }}
                    onMenu={() => {
                      if (row.type !== "element") {
                        setMenuScene(row.key);
                        return;
                      }
                      setMenuElement(row.key);
                      if (!chosen.has(row.key)) select(key, row.key);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </ContextMenu.Trigger>
        {menuScene === null && (
          <ElementMenu document={document} entry={entry} element={menuElement} />
        )}
        {menuScene !== null && <SceneMenu document={document} entry={entry} scene={menuScene} />}
      </ContextMenu.Root>
    </div>
  );
}

function withoutAll(held: ReadonlySet<string>, gone: Iterable<string>): ReadonlySet<string> {
  const next = new Set(held);
  for (const each of gone) next.delete(each);
  return next;
}

/**
 * What a key asks of the tree from the row at `at`: a row to move to, a fold to switch, the row's
 * own action, framing its element, or nothing. `page` is how many rows a Page key moves.
 */
function navigation(
  key: string,
  row: LayerRow,
  at: number,
  rows: readonly LayerRow[],
  page: number,
): number | "toggle" | "act" | "frame" | null {
  const stepped = steppedRow(key, at, rows.length, page);
  if (stepped !== null) return stepped;

  switch (key) {
    case "Enter":
    case " ":
      return "act";
    case "f":
    case "F":
      return row.type === "element" ? "frame" : null;
    case "ArrowRight":
      if (!row.folds) return null;
      return row.open ? at + 1 : "toggle";
    case "ArrowLeft":
      if (row.folds && row.open) return "toggle";
      return parentIndex(rows, at);
    default:
      return null;
  }
}

/** The row the row at `at` sits under, null for a root. */
function parentIndex(rows: readonly LayerRow[], at: number): number | null {
  const depth = rows[at]?.depth ?? 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    if ((rows[index]?.depth ?? 0) < depth) return index;
  }
  return null;
}
