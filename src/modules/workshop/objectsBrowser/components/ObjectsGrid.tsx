import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { useContentVisible, useReducedMotion, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";

import { useMeasuredWidth } from "../../explorer/components/ExplorerSurface";
import { nameTypeFor } from "../../explorer/utils/tileName";
import { type ObjectsReveal, useSelectedObjectPath, useSelectObjectNode } from "../../state";
import { useOpenObjectNode } from "../hooks/useOpenObjectNode";
import { usePreviewScope } from "../hooks/usePreviewScope";
import {
  retryPreviews,
  stillKey,
  usePinnedPreviews,
  usePreviewOutcomes,
} from "../state/previewStills";
import { objectPreviewKey, objectPreviewKind, playsOnHover } from "../utils/objectPreview";
import type { ObjectRowNode, ObjectTreeNode } from "../utils/objectTree";
import { type PreviewRequest, usePreviewPool } from "./ObjectPreviewPool";
import type { ObjectPreviewJob } from "./ObjectPreviewSlot";
import { ObjectsContextMenu } from "./ObjectsContextMenu";
import { ObjectTile, TILE_NAME_LINES } from "./ObjectTile";

/** Hover time before a tile's preview plays. */
const HOVER_MS = 400;
const TILE_SELECTOR = "[data-tile-index]";
const CELL_GUTTER = 12;
const TILE_PADDING = 6;
const TILE_GAP = 4;
/** Art height divided by art width. The preview canvases use the same ratio. */
const ART_ASPECT = 0.72;

/** The request built during render. The live tile is an index until the layout effect finds its element. */
interface RequestDraft {
  readonly request: PreviewRequest;
  readonly live: {
    readonly job: ObjectPreviewJob;
    readonly mode: "tile" | "large";
    readonly index: number;
  } | null;
}

/** The draft with the live tile index replaced by its stage or anchor element. */
function resolveRequest(
  draft: RequestDraft | null,
  root: HTMLElement | null,
): PreviewRequest | null {
  if (draft === null || draft.live === null || root === null) return draft?.request ?? null;

  const { job, mode, index } = draft.live;
  if (mode === "large") {
    const anchor = root.querySelector<HTMLElement>(`[data-object-index="${index}"]`);
    return anchor === null
      ? draft.request
      : { ...draft.request, live: { job, display: { mode, anchor } } };
  }

  const stage = root.querySelector<HTMLElement>(`[data-preview-stage="${index}"]`);
  return stage === null
    ? draft.request
    : { ...draft.request, live: { job, display: { mode, stage } } };
}

interface ObjectsGridProps {
  nodes: readonly ObjectTreeNode[];
  thumbnails: boolean;
  size?: number;
  onDescend: (path: string) => void;
  onUp: () => void;
  reveal?: ObjectsReveal | null;
  onRevealed?: (token: number) => void;
}

/**
 * Virtualized object tiles, with stills rendered by the document's preview pool.
 *
 * Only visible rows request stills, and no request starts during a scroll. A hovered tile
 * plays in place. Space opens the hovered tile, or the focused tile, in the large popover.
 */
export function ObjectsGrid({
  nodes,
  thumbnails,
  size = 128,
  onDescend,
  onUp,
  reveal = null,
  onRevealed,
}: ObjectsGridProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(scroll);
  const zoomed = useZoomedPx();
  const visible = useContentVisible();
  const reducedMotion = useReducedMotion();
  const open = useOpenObjectNode();
  const selectNode = useSelectObjectNode();
  const selectedPath = useSelectedObjectPath();
  const pool = usePreviewPool();
  const scope = usePreviewScope();
  const outcomes = usePreviewOutcomes();
  const items = useMemo(
    () => nodes.filter((node) => node.type === "object" || node.type === "prefix"),
    [nodes],
  );

  const tileWidth = zoomed(size);
  const gutter = zoomed(CELL_GUTTER);
  const nameType = nameTypeFor(size);
  const artHeight = zoomed(Math.round((size - TILE_PADDING * 2) * ART_ASPECT));
  const rowHeight =
    artHeight + zoomed(nameType.line * (TILE_NAME_LINES + 1) + TILE_PADDING * 2 + TILE_GAP * 2);
  const columns = Math.max(1, Math.floor((width + gutter) / (tileWidth + gutter)));

  const [focused, setFocused] = useState(0);
  const [aimed, setAimed] = useState<ObjectRowNode | null>(null);
  const [hovered, setHovered] = useState<ObjectRowNode | null>(null);
  const [expanded, setExpanded] = useState<ObjectRowNode | null>(null);
  const [menuNode, setMenuNode] = useState<ObjectTreeNode | null>(null);

  useEffect(() => {
    setAimed(null);
    setHovered(null);
    setExpanded(null);
  }, [nodes]);

  const virtualizer = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 1,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns, rowHeight]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHovered(aimed), HOVER_MS);
    return () => window.clearTimeout(timer);
  }, [aimed]);

  const rows = virtualizer.getVirtualItems();
  const revealed = useRef<ObjectsReveal | null>(null);
  useEffect(() => {
    if (reveal === null || revealed.current === reveal || !visible || width === 0) {
      return;
    }

    const index = items.findIndex((node) => node.id === reveal.path);
    if (index < 0) {
      revealed.current = reveal;
      onRevealed?.(reveal.token);
      return;
    }

    setFocused(index);
    virtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" });
    const frame = requestAnimationFrame(() => {
      const tile = scroll.current?.querySelector<HTMLElement>(`[data-object-index="${index}"]`);
      if (tile) {
        tile.focus();
        revealed.current = reveal;
        onRevealed?.(reveal.token);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [reveal, rows, items, columns, visible, width, virtualizer, onRevealed]);

  const keyOf = (node: ObjectRowNode) => stillKey(objectPreviewKey(node), scope);
  const inView = rows.flatMap((row) => items.slice(row.index * columns, (row.index + 1) * columns));
  const candidates = inView.filter(
    (node): node is ObjectRowNode => node.type === "object" && objectPreviewKind(node) !== null,
  );
  const shownKeys = thumbnails ? candidates.map(keyOf).join("\n") : "";
  const pinned = useMemo(() => new Set(shownKeys.split("\n").filter(Boolean)), [shownKeys]);
  usePinnedPreviews(pinned);

  const drawable = (node: ObjectRowNode | null): node is ObjectRowNode =>
    node !== null &&
    candidates.some((candidate) => candidate.id === node.id) &&
    outcomes.get(keyOf(node))?.kind !== "empty";
  const hoverPlays =
    drawable(hovered) &&
    hovered.id === aimed?.id &&
    !reducedMotion &&
    playsOnHover(objectPreviewKind(hovered));
  let live: { node: ObjectRowNode; mode: "tile" | "large" } | null = null;
  if (drawable(expanded)) {
    live = { node: expanded, mode: "large" };
  } else if (hoverPlays) {
    live = { node: hovered, mode: "tile" };
  }

  const stills = candidates
    .filter((node) => !outcomes.has(keyOf(node)))
    .map((node): ObjectPreviewJob => ({ key: keyOf(node), node }));
  const admit = !virtualizer.isScrolling;
  const liveKey = live === null ? "" : `${live.mode}:${keyOf(live.node)}`;
  const signature = `${thumbnails}|${admit}|${liveKey}|${stills.map((job) => job.key).join("\n")}`;

  const dismiss = useCallback(() => setExpanded(null), []);
  const draft = useRef<RequestDraft | null>(null);
  draft.current = thumbnails
    ? {
        request: { live: null, stills, admit, onDismiss: dismiss },
        live:
          live === null
            ? null
            : {
                job: { key: keyOf(live.node), node: live.node },
                mode: live.mode,
                index: items.indexOf(live.node),
              },
      }
    : null;

  useLayoutEffect(() => {
    pool?.submit(resolveRequest(draft.current, scroll.current));
  }, [pool, signature]);

  useLayoutEffect(() => () => pool?.submit(null), [pool]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const descendRef = useRef(onDescend);
  descendRef.current = onDescend;
  const descend = useCallback((path: string) => descendRef.current(path), []);
  const focusTile = useCallback(
    (index: number) => {
      setFocused(index);
      const node = itemsRef.current[index];
      if (node) selectNode(node);
    },
    [selectNode],
  );
  const openMenu = useCallback((index: number) => {
    setMenuNode(itemsRef.current[index] ?? null);
  }, []);

  const focus = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setFocused(next);
    virtualizer.scrollToIndex(Math.floor(next / columns));
    requestAnimationFrame(() =>
      scroll.current?.querySelector<HTMLElement>(`[data-object-index="${next}"]`)?.focus(),
    );
  };

  const aimAt = (target: EventTarget | null) => {
    const tile = target instanceof Element ? target.closest(TILE_SELECTOR) : null;
    const node = tile === null ? undefined : items[Number(tile.getAttribute("data-tile-index"))];
    const next = node?.type === "object" && objectPreviewKind(node) !== null ? node : null;
    setAimed((current) => (current?.id === next?.id ? current : next));
  };

  const toggleLarge = () => {
    const target = aimed ?? items[Math.min(focused, items.length - 1)];
    if (target?.type !== "object" || objectPreviewKind(target) === null || !thumbnails) return;

    setExpanded((current) => (current?.id === target.id ? null : target));
  };

  const menuKey = menuNode?.type === "object" ? keyOf(menuNode) : null;
  const menuFailed = menuKey !== null && outcomes.get(menuKey)?.kind === "failed";

  return (
    <div data-ui="ObjectsGrid" className="relative flex min-h-0 flex-1 flex-col">
      <ContextMenu.Root>
        <ContextMenu.Trigger className="flex min-h-0 flex-1 flex-col">
          <div
            ref={scroll}
            role="grid"
            tabIndex={-1}
            aria-label={m.workshop_objects_title()}
            aria-rowcount={Math.ceil(items.length / columns)}
            aria-colcount={columns}
            className="min-h-0 flex-1 overflow-auto p-2 select-none"
            onPointerOver={(event) => aimAt(event.target)}
            onPointerLeave={() => setAimed(null)}
            onKeyUp={(event) => {
              if (event.key === " ") event.preventDefault();
            }}
            onKeyDown={(event) => {
              const offsets: Record<string, number> = {
                ArrowRight: 1,
                ArrowLeft: -1,
                ArrowDown: columns,
                ArrowUp: -columns,
              };
              if (event.ctrlKey && event.key === "Enter") {
                event.preventDefault();
                const node = items[focused];
                if (node?.type === "object") {
                  open(node, "beside");
                }
              } else if (event.key === " ") {
                event.preventDefault();
                toggleLarge();
              } else if (event.key === "Backspace" || (event.altKey && event.key === "ArrowUp")) {
                event.preventDefault();
                onUp();
              } else if (event.key in offsets) {
                event.preventDefault();
                focus(focused + offsets[event.key]!);
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                focus(event.key === "Home" ? 0 : items.length - 1);
              } else if (event.key === "Escape") {
                setAimed(null);
                setHovered(null);
                setExpanded(null);
              }
            }}
          >
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {rows.map((row) => (
                <div
                  key={row.key}
                  role="row"
                  aria-rowindex={row.index + 1}
                  className="absolute inset-x-0 flex"
                  style={{ transform: `translateY(${row.start}px)`, gap: gutter }}
                >
                  {items
                    .slice(row.index * columns, (row.index + 1) * columns)
                    .map((node, column) => {
                      const index = row.index * columns + column;
                      const key = node.type === "object" ? keyOf(node) : null;
                      const outcome = thumbnails && key !== null ? outcomes.get(key) : undefined;

                      return (
                        <ObjectTile
                          key={node.id}
                          node={node}
                          index={index}
                          column={column}
                          width={tileWidth}
                          artHeight={artHeight}
                          nameType={nameType}
                          focused={index === Math.min(focused, items.length - 1)}
                          selected={node.id === selectedPath}
                          outcome={outcome}
                          loading={
                            thumbnails &&
                            key !== null &&
                            outcome === undefined &&
                            (pool?.running.has(key) ?? false)
                          }
                          onFocusTile={focusTile}
                          onMenu={openMenu}
                          onDescend={descend}
                        />
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </ContextMenu.Trigger>
        <ObjectsContextMenu
          node={menuNode}
          onOpen={open}
          onRetryPreview={menuFailed ? () => retryPreviews([menuKey]) : undefined}
        />
      </ContextMenu.Root>
    </div>
  );
}
