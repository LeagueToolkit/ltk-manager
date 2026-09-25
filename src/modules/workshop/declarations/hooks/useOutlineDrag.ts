import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  type SensorDescriptor,
  type SensorOptions,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";

import { type DropTarget, dropTarget } from "../utils/outlineDrop";
import type { OutlineNode } from "../utils/outlineTree";
import type { ModuleLanding, OutlineActions } from "./useOutlineActions";

/* Past this, a press on a row is a drag rather than a click. */
const DRAG_DISTANCE = 6;

/** A drag over the outline: what is held, where it would land, and the context's handlers. */
export interface OutlineDrag {
  sensors: SensorDescriptor<SensorOptions>[];
  dragged: OutlineNode | null;
  drop: DropTarget | null;
  /** Whether the click under way is the one that ended a drag. */
  isDragClick: () => boolean;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
}

/**
 * Drag a module to a new place in the apply order, or an entry or a key into another `entries`
 * module, and follow a moved module to where it lands. ADR-0054.
 */
export function useOutlineDrag(
  actions: OutlineActions | undefined,
  follow: (landing: ModuleLanding | null, rename: boolean) => void,
): OutlineDrag {
  const [dragged, setDragged] = useState<OutlineNode | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const dragEnded = useRef(false);
  const isDragClick = useCallback(() => dragEnded.current, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const from = nodeOf(event.active.data);
      const over = nodeOf(event.over?.data);
      const target = from !== null && over !== null ? dropTarget(from, over) : null;

      setDragged(null);
      setDrop(null);
      dragEnded.current = true;
      setTimeout(() => {
        dragEnded.current = false;
      }, 0);

      if (target === null || from === null || actions === undefined) return;
      const { layer, module } = target;
      if (from.type === "module") {
        void actions
          .move(layer, from.module, module.index)
          .then((landing) => follow(landing, false));
      }
      if (from.type === "entry") {
        void actions.moveKeys(layer, from.module, from.entry, null, module.index);
      }
      if (from.type === "key") {
        void actions.moveKeys(layer, from.module, from.entry, from.key.path, module.index);
      }
    },
    [actions, follow],
  );

  return {
    sensors,
    dragged,
    drop,
    isDragClick,
    onDragStart: (event) => setDragged(nodeOf(event.active.data)),
    onDragOver: (event) => {
      const over = nodeOf(event.over?.data);
      setDrop(dragged !== null && over !== null ? dropTarget(dragged, over) : null);
    },
    onDragEnd,
    onDragCancel: () => {
      setDragged(null);
      setDrop(null);
    },
  };
}

/** The outline node a row put in its draggable or droppable data. */
function nodeOf(data: { current?: unknown } | undefined): OutlineNode | null {
  const held = data?.current as { node?: OutlineNode } | undefined;
  return held?.node ?? null;
}
