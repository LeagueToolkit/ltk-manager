import {
  type ClientRect,
  closestCenter,
  type CollisionDetection,
  pointerWithin,
} from "@dnd-kit/core";
import type { SortingStrategy } from "@dnd-kit/sortable";

/** Nothing shifts under the pointer: the drop line marks the gap instead. */
export const noSorting: SortingStrategy = () => null;

const FOLDER_DROP_PREFIX = "folder:";

export function parseFolderDropId(id: string): string | null {
  if (id.startsWith(FOLDER_DROP_PREFIX)) return id.slice(FOLDER_DROP_PREFIX.length);
  return null;
}

export type DropTarget = { type: "folder"; folderId: string } | { type: "reorder" };

export function resolveDropTarget(overId: string): DropTarget {
  const folderId = parseFolderDropId(overId);
  if (folderId) return { type: "folder", folderId };
  return { type: "reorder" };
}

const SORTABLE_FOLDER_PREFIX = "sortable-folder:";

export function toSortableFolderId(folderId: string): string {
  return `${SORTABLE_FOLDER_PREFIX}${folderId}`;
}

export function parseSortableFolderId(id: string): string | null {
  if (id.startsWith(SORTABLE_FOLDER_PREFIX)) return id.slice(SORTABLE_FOLDER_PREFIX.length);
  return null;
}

export function hasOrderChanged(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export const REMOVE_FROM_FOLDER_ID = "remove-from-folder";

export function resolveFolderId(id: string): string | null {
  return parseFolderDropId(id) ?? parseSortableFolderId(id);
}

export function gridClass(viewMode: "grid" | "list") {
  if (viewMode === "list") return "grid grid-cols-1 gap-2";
  return "grid grid-cols-[repeat(auto-fill,minmax(var(--card-min-w,240px),var(--card-max-w,320px)))] justify-center gap-4";
}

/** Which edge of a card the drop line sits on. */
export type DropSide = "before" | "after";

/** The gap a dragged mod would land in, named by the card it sits beside. */
export interface DropSlot {
  id: string;
  side: DropSide;
}

/**
 * The gap `activeId` lands in when it is over `overId`.
 *
 * Dragging down lands after the card under the cursor and dragging up lands
 * before it, which is the gap the pointer has most recently crossed. `null`
 * when there is no gap to mark, so the line hides rather than pointing at the
 * slot the mod already holds.
 */
export function dropSlotFor(
  order: readonly string[],
  activeId: string,
  overId: string,
): DropSlot | null {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  return { id: overId, side: from < to ? "after" : "before" };
}

/** `order` with `activeId` lifted out and dropped into the gap `slot` marks. */
export function applyDropSlot(
  order: readonly string[],
  activeId: string,
  slot: DropSlot,
): string[] {
  const rest = order.filter((id) => id !== activeId);
  const at = rest.indexOf(slot.id);
  if (at === -1) return [...order];

  const insert = slot.side === "after" ? at + 1 : at;
  return [...rest.slice(0, insert), activeId, ...rest.slice(insert)];
}

/** Whether two slots mark the same gap, so hovering within one stops re-rendering. */
export function isSameSlot(a: DropSlot | null, b: DropSlot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.side === b.side;
}

/**
 * The card whose centre is nearest the pointer, whatever the dragged box is doing.
 *
 * `closestCenter` measures from the dragged card's own box. The overlay is
 * snapped to the cursor, but that box is not - it stays wherever in the card
 * the drag started, so it trails the pointer by up to half a card and the line
 * lands a column or a row away from where the reader is pointing.
 */
export const nearestToPointer: CollisionDetection = (args) => {
  const pointer = args.pointerCoordinates;
  if (!pointer) return closestCenter(args);

  const dot: ClientRect = {
    top: pointer.y,
    bottom: pointer.y,
    left: pointer.x,
    right: pointer.x,
    width: 0,
    height: 0,
  };
  return closestCenter({ ...args, collisionRect: dot });
};

/** The card under the pointer, or the nearest one when the pointer is in a gutter. */
export const closestToPointer: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  if (under.length > 0) return under;
  return nearestToPointer(args);
};

type CollisionArgs = Parameters<CollisionDetection>[0];

/**
 * The remove zone, when the pointer is inside it.
 *
 * Measured against the one container rather than the library, because this
 * runs on every pointer move and every card in the library is a container.
 */
export function pointerInRemoveZone(args: CollisionArgs) {
  const zone = args.droppableContainers.filter((c) => c.id === REMOVE_FROM_FOLDER_ID);
  if (zone.length === 0) return null;
  return pointerWithin({ ...args, droppableContainers: zone })[0] ?? null;
}

/** The drop line one card draws, or none. */
export interface CardDropLine {
  /** The edge the line sits on, or `null` when this card is not the target. */
  side: DropSide | null;
  /** False while the line is leaving, which is what fades it out. */
  visible: boolean;
}

/** One shared value for every card that is not the target, so `memo` holds. */
export const NO_DROP_LINE: CardDropLine = Object.freeze({ side: null, visible: false });

/**
 * What card `id` draws for the list's one drop line.
 *
 * The whole list shares a target and a visibility, and handing both to every
 * card gave each of them a prop that changed on every fade. Only the target
 * ever gets a value of its own.
 */
export function dropLineFor(
  line: { slot: DropSlot | null; visible: boolean } | undefined,
  id: string,
): CardDropLine {
  if (!line?.slot || line.slot.id !== id) return NO_DROP_LINE;
  return { side: line.slot.side, visible: line.visible };
}
