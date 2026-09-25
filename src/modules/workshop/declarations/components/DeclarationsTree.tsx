import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL, useZoomedPx } from "@/hooks";
import type { DeclarationsLayer, DeclaredModule } from "@/lib/tauri";

import { useReadOnlyTreeNav } from "../../hooks";
import type { OpenIntent } from "../../palette/utils/types";
import type { ModuleLanding, OutlineActions } from "../hooks/useOutlineActions";
import { useOutlineDrag } from "../hooks/useOutlineDrag";
import {
  ancestorIds,
  flattenOutline,
  isBranch,
  moduleItemId,
  type OutlineNode,
  type OutlineShape,
  pathColumn,
} from "../utils/outlineTree";
import { DeclarationsTreeRow } from "./DeclarationsTreeRow";
import { type OutlineMenuHandlers, OutlineMenuItems } from "./OutlineMenuItems";
import { DragChip, OutlineRowContext, type OutlineRowShared } from "./OutlineRowParts";

/* Every read-only tree of the editor scans alike. */
const ROW_HEIGHT = 24;

/** A request to select and show one item, told apart from the last by its token. */
export interface OutlineReveal {
  itemId: string;
  /** Type over the module's name once it shows. */
  rename?: boolean;
  token: number;
}

interface DeclarationsTreeProps {
  layers: readonly DeclarationsLayer[];
  shape: OutlineShape;
  ariaLabel: string;
  /** What `Enter`, a click on a leaf, or a row's own action does. */
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
  /** Whether a click on a branch opens it rather than folding it. */
  openBranches: boolean;
  /** The module actions the rows offer, or none for a tree that only reads. */
  actions?: OutlineActions;
  /** Select a node's lines in the manifest's text. Absent where no text is on screen. */
  onShowInText?: (node: OutlineNode) => void;
  reveal?: OutlineReveal | null;
  onRevealed?: (token: number) => void;
  /** The row the keyboard sits on, as it moves. */
  onSelect?: (node: OutlineNode | null) => void;
}

/**
 * A read-only virtualized tree over a project's declarations: layer, module, entry, key.
 *
 * - Every branch starts open. A reveal opens the branches above its item, then selects and
 *   scrolls to it.
 * - Every key's value starts at one column, as wide as the longest path up to a cap.
 * - With `actions`, a row's context menu and a module's kebab carry the module actions, and a
 *   module takes `F2` to rename, `Alt+↑` and `Alt+↓` to move and `Delete` to remove.
 * - With `actions`, a module drags to a new place in the apply order, and an entry or a key of
 *   an `entries` module drags into another one. A New module line ends each layer.
 * - A module just made shows with its name being typed.
 */
export function DeclarationsTree({
  layers,
  shape,
  ariaLabel,
  onOpen,
  openBranches,
  actions,
  onShowInText,
  reveal = null,
  onRevealed,
  onSelect,
}: DeclarationsTreeProps) {
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuNode, setMenuNode] = useState<OutlineNode | null>(null);
  /* A module's id is its place, so a moved or made module is found in the outline the action
     read again, once the tree draws that one. */
  const [following, setFollowing] = useState<{ landing: ModuleLanding; rename: boolean } | null>(
    null,
  );
  const follow = useCallback((landing: ModuleLanding | null, rename: boolean) => {
    if (landing !== null) setFollowing({ landing, rename });
  }, []);

  const isShut = useCallback((id: string) => shut.has(id), [shut]);
  const rows = useMemo(() => flattenOutline(layers, isShut, shape), [layers, isShut, shape]);
  const pathCols = useMemo(() => pathColumn(layers), [layers]);

  const toggle = useCallback((node: OutlineNode) => {
    setShut((held) => {
      const next = new Set(held);
      if (!next.delete(node.id)) next.add(node.id);
      return next;
    });
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rows[index]!.node.id,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  const modulesOf = useCallback(
    (layer: string): readonly DeclaredModule[] =>
      layers.find((held) => held.layer === layer)?.modules ?? [],
    [layers],
  );

  const create = useCallback(
    (layer: string) => {
      if (actions === undefined) return;
      void actions.create(layer).then((landing) => follow(landing, true));
    },
    [actions, follow],
  );

  const open = useCallback(
    (node: OutlineNode, intent: OpenIntent) => {
      if (node.type === "add") {
        create(node.layer);
        return;
      }
      onOpen(node, intent);
    },
    [create, onOpen],
  );

  const { focusedIndex, setFocusedIndex, moveFocus, handleKeyDown } = useReadOnlyTreeNav({
    rows,
    isExpanded: (node: OutlineNode) => isBranch(node, shape) && !shut.has(node.id),
    onToggle: toggle,
    onOpen: open,
    expandable: (node: OutlineNode) => isBranch(node, shape),
    activation: (node: OutlineNode) => {
      if (openBranches || !isBranch(node, shape)) return "open";
      return "toggle";
    },
    virtualizer,
    scrollElementRef: scrollRef,
  });

  const selected = rows[focusedIndex]?.node ?? null;
  useEffect(() => {
    onSelect?.(selected);
  }, [selected, onSelect]);

  /* A rename takes the focus into its field, so the row is selected and scrolled to without
     being focused. */
  const land = useCallback(
    (at: number, rename: boolean) => {
      if (!rename) {
        moveFocus(at);
        return;
      }

      setFocusedIndex(at);
      virtualizer.scrollToIndex(at, { align: "auto", behavior: "auto" });
      setRenamingId(rows[at]!.node.id);
    },
    [moveFocus, rows, setFocusedIndex, virtualizer],
  );

  /* The branches open first, and the row is looked up on the render that draws it. */
  useEffect(() => {
    if (!reveal) return;

    const closed = ancestorIds(reveal.itemId).filter((id) => shut.has(id));
    if (closed.length > 0) {
      setShut((held) => {
        const next = new Set(held);
        for (const id of closed) next.delete(id);
        return next;
      });
      return;
    }

    const at = rows.findIndex((row) => row.node.id === reveal.itemId);
    if (at >= 0) land(at, reveal.rename === true);
    onRevealed?.(reveal.token);
  }, [reveal, rows, shut, land, onRevealed]);

  useEffect(() => {
    if (following === null) return;

    const { landing, rename } = following;
    const drawn = layers.find((layer) => layer.layer === landing.layer.layer);
    if (drawn !== landing.layer) return;

    const id = moduleItemId(landing.layer.layer, landing.index);
    const at = rows.findIndex((row) => row.node.id === id);
    if (at >= 0) land(at, rename);
    setFollowing(null);
  }, [following, layers, rows, land]);

  const drag = useOutlineDrag(actions, follow);

  const handlers = useMemo<OutlineMenuHandlers | null>(() => {
    if (actions === undefined) return null;

    return {
      actions,
      modulesOf,
      onOpen: open,
      onRename: (node) => {
        if (node.type === "module") setRenamingId(node.id);
      },
      onCreate: create,
      onMoveToNew: (layer, module, entry, path) => {
        void actions
          .moveToNewModule(layer, module, entry, path)
          .then((landing) => follow(landing, true));
      },
      onShowInText,
    };
  }, [actions, create, follow, modulesOf, onShowInText, open]);

  const endRename = useCallback(() => {
    setRenamingId(null);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>("[tabindex='0']")?.focus(),
    );
  }, []);

  const shared = useMemo<OutlineRowShared>(
    () => ({
      shape,
      handlers,
      renamingId,
      endRename,
      drop: drag.drop,
      draggedId: drag.dragged?.id ?? null,
      isDragClick: drag.isDragClick,
    }),
    [shape, handlers, renamingId, endRename, drag.drop, drag.dragged, drag.isDragClick],
  );

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      handlers !== null &&
      selected?.type === "module" &&
      moduleKey(event, selected, handlers, (landing) => follow(landing, false))
    ) {
      event.preventDefault();
      return;
    }
    handleKeyDown(event);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-treeitem-index]");
    const at = row === null ? -1 : Number(row.dataset.treeitemIndex);
    const node = rows[at]?.node ?? null;
    if (node === null || handlers === null) {
      event.preventDefault();
      setMenuNode(null);
      return;
    }

    setFocusedIndex(at);
    setMenuNode(node);
  }

  return (
    <OutlineRowContext value={shared}>
      <DndContext
        sensors={drag.sensors}
        collisionDetection={pointerWithin}
        onDragStart={drag.onDragStart}
        onDragOver={drag.onDragOver}
        onDragEnd={drag.onDragEnd}
        onDragCancel={drag.onDragCancel}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger
            data-ui="DeclarationsTree"
            ref={scrollRef}
            className="flex-1 overflow-auto font-mono text-xs outline-none scrollbar-md scrollbar-track"
            role="tree"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={handleTreeKeyDown}
            onContextMenu={handleContextMenu}
            style={{ "--path-cols": pathCols } as CSSProperties}
            {...NO_OVERSCROLL}
          >
            <div
              role="presentation"
              data-tree-rows=""
              className="relative w-full"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                const isSelected = virtualRow.index === focusedIndex;

                return (
                  <div
                    key={virtualRow.key}
                    role="presentation"
                    className="absolute inset-x-0"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <DeclarationsTreeRow
                      node={row.node}
                      depth={row.depth}
                      branch={isBranch(row.node, shape)}
                      isExpanded={!shut.has(row.node.id)}
                      isSelected={isSelected}
                      openBranches={openBranches}
                      onToggle={toggle}
                      onSelect={setFocusedIndex}
                      onOpen={open}
                      height={rowHeight}
                      rowIndex={virtualRow.index}
                      tabIndex={isSelected ? 0 : -1}
                    />
                  </div>
                );
              })}
            </div>
          </ContextMenu.Trigger>

          {handlers !== null && menuNode !== null && (
            <ContextMenu.Portal>
              <ContextMenu.Positioner>
                <ContextMenu.Popup data-ui="DeclarationsTree:menu" className="w-60">
                  <OutlineMenuItems node={menuNode} handlers={handlers} />
                </ContextMenu.Popup>
              </ContextMenu.Positioner>
            </ContextMenu.Portal>
          )}
        </ContextMenu.Root>

        <DragOverlay dropAnimation={null}>
          {drag.dragged !== null && <DragChip node={drag.dragged} />}
        </DragOverlay>
      </DndContext>
    </OutlineRowContext>
  );
}

/** Run the module action a key names on the selected module, and say whether one ran. */
function moduleKey(
  event: KeyboardEvent,
  node: Extract<OutlineNode, { type: "module" }>,
  handlers: OutlineMenuHandlers,
  follow: (landing: ModuleLanding | null) => void,
): boolean {
  const { actions } = handlers;
  const { layer, module } = node;
  const last = handlers.modulesOf(layer).length - 1;

  if (event.key === "F2") {
    handlers.onRename(node);
    return true;
  }
  if (event.key === "Delete") {
    actions.remove(layer, module);
    return true;
  }
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const to = module.index + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to > last) return true;

    void actions.move(layer, module, to).then(follow);
    return true;
  }
  return false;
}
