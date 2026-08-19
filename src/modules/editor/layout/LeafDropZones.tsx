import { useDndContext, useDroppable } from "@dnd-kit/core";
import { type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useResizeObserver } from "@/hooks";

import { decodeDroppableId, leafDroppableId } from "./dnd";
import type { Edge } from "./tree";

/* Below these a leaf cannot hold two readable panes, so it reports its centre
   alone and a drag never produces a split that cannot be read. */
const MIN_SPLIT_WIDTH = 240;
const MIN_SPLIT_HEIGHT = 160;

/* An edge band is 20% of the leaf's own axis, clamped to 32-120px. */
const EDGE_BANDS: Record<Edge, string> = {
  top: "inset-x-0 top-0 h-[clamp(32px,20%,120px)]",
  right: "inset-y-0 right-0 w-[clamp(32px,20%,120px)]",
  bottom: "inset-x-0 bottom-0 h-[clamp(32px,20%,120px)]",
  left: "inset-y-0 left-0 w-[clamp(32px,20%,120px)]",
};

/* Every offset is set in every state, so the one element glides between the
   whole surface and a half rather than swapping. */
const PREVIEW_INSETS: Record<"center" | Edge, string> = {
  center: "top-0 right-0 bottom-0 left-0",
  top: "top-0 right-0 bottom-1/2 left-0",
  right: "top-0 right-0 bottom-0 left-1/2",
  bottom: "top-1/2 right-0 bottom-0 left-0",
  left: "top-0 right-1/2 bottom-0 left-0",
};

export interface LeafDropZonesProps {
  leafId: string;
  /** The leaf's tab ids, for muting the preview of a drop the resolver refuses. */
  tabs: readonly string[];
  children: ReactNode;
}

/**
 * The five droppable regions of one leaf, and the drop preview they share.
 *
 * The zones are mounted at all times because dnd-kit measures droppables at
 * drag start. The preview is one element that covers the leaf edge to edge
 * over the centre and slides into the target half near an edge, as Visual
 * Studio Code's does. Everything stays `pointer-events-none`, since collision
 * is computed from pointer coordinates rather than from the DOM under the
 * cursor.
 */
export function LeafDropZones({ leafId, tabs, children }: LeafDropZonesProps) {
  const { active, over } = useDndContext();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observe = useResizeObserver<HTMLDivElement>((element) =>
    setSize({ width: element.clientWidth, height: element.clientHeight }),
  );

  const dragged = active ? decodeDroppableId(String(active.id)) : null;
  const draggedDocumentId = dragged?.kind === "tab" ? dragged.documentId : null;
  const selfOnly =
    draggedDocumentId !== null && tabs.length === 1 && tabs.includes(draggedDocumentId);

  const overTarget = over ? decodeDroppableId(String(over.id)) : null;
  const hovered =
    overTarget?.kind === "leaf" && overTarget.leafId === leafId ? overTarget.region : null;
  /* An edge whose split the resolver refuses paints nothing. The centre stays
     visible even over the tab's own leaf, where a drop just leaves it in place. */
  const region = hovered === "center" || (hovered !== null && !selfOnly) ? hovered : null;

  return (
    <div
      ref={observe}
      data-ui={`LeafDropZones:${leafId}`}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {children}
      <div className="pointer-events-none absolute inset-0 z-30">
        <Zone id={leafDroppableId(leafId, "center")} className="inset-0" />
        {(["top", "right", "bottom", "left"] as const).map((edge) => (
          <Zone
            key={edge}
            id={leafDroppableId(leafId, edge)}
            className={EDGE_BANDS[edge]}
            disabled={
              edge === "left" || edge === "right"
                ? size.width < MIN_SPLIT_WIDTH
                : size.height < MIN_SPLIT_HEIGHT
            }
          />
        ))}
        {region !== null && (
          <div
            className={twMerge(
              "absolute rounded-xl border border-accent-500 bg-accent-500/12 transition-all duration-150 ease-out",
              PREVIEW_INSETS[region],
            )}
          />
        )}
      </div>
    </div>
  );
}

interface ZoneProps {
  id: string;
  className: string;
  disabled?: boolean;
}

function Zone({ id, className, disabled }: ZoneProps) {
  const { setNodeRef } = useDroppable({ id, disabled });
  return <div ref={setNodeRef} className={twMerge("absolute", className)} />;
}
