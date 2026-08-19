import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type ReactNode, useCallback, useState } from "react";

import { decodeDroppableId, type DropOutcome, resolveDrop } from "./dnd";
import type { LayoutNode } from "./tree";

export interface TabDndProviderProps {
  /** The tree the drop resolves against, read at drop time. */
  tree: LayoutNode;
  onDrop: (outcome: DropOutcome) => void;
  /** The drag ghost for one document, carried under the pointer. */
  overlay: (documentId: string) => ReactNode;
  children: ReactNode;
}

/*
 * A tab collision outranks an edge, and an edge outranks the centre. Without
 * the rank the centre zone under the strip swallows every tab collision, since
 * `pointerWithin` reports every droppable under the pointer.
 */
function rankOf(id: string | number): number {
  const target = decodeDroppableId(String(id));
  if (!target) return 3;
  if (target.kind === "tab") return 0;
  return target.region === "center" ? 2 : 1;
}

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return [...within].sort((a, b) => rankOf(a.id) - rankOf(b.id));

  /* The fallback for a pointer outside every leaf, so a drop just past a seam
     still lands somewhere sensible rather than nowhere. */
  return closestCenter(args);
};

/**
 * The one `DndContext` of the editor grid: sensors, collision rank, ghost.
 *
 * It sits at the grid's root and never wraps a side panel, so the sidebar's
 * own layer-reorder context never nests inside it (D6). The drop commits in
 * one tree operation with no optimistic move (D7).
 */
export function TabDndProvider({ tree, onDrop, overlay, children }: TabDndProviderProps) {
  /* Below the threshold the gesture stays a click, so a tab still activates and
     its close button still fires without a drag starting under them. */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const target = decodeDroppableId(String(event.active.id));
    setDraggedDocumentId(target?.kind === "tab" ? target.documentId : null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedDocumentId(null);
      const { active, over } = event;
      if (!over) return;

      const outcome = resolveDrop(tree, String(active.id), String(over.id));
      if (outcome) onDrop(outcome);
    },
    [tree, onDrop],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggedDocumentId(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {draggedDocumentId !== null && overlay(draggedDocumentId)}
      </DragOverlay>
    </DndContext>
  );
}
