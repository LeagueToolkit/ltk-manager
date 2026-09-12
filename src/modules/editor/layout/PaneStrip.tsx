import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { XIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode } from "react";

import { IconButton, Tabs } from "@/components";
import { twMerge } from "@/utils";

import { tabDroppableId } from "./dnd";
import { useForeignCaretIndex } from "./useForeignCaretIndex";

/** One item of a strip: what the tab says, and what the tree holds it under. */
export interface StripPane {
  id: string;
  title: string;
  icon?: ReactNode;
}

export interface PaneStripProps {
  /** The leaf this strip belongs to, which scopes its sortable ids across strips. */
  leafId: string;
  panes: readonly StripPane[];
  activeId: string | null;
  onActivate: (id: string) => void;
  /** Absent leaves the strip without close buttons, for a host whose panes are fixed. */
  onClose?: (id: string) => void;
  /** A double click on a tab, which fills the shell with this leaf. */
  onMaximize?: () => void;
  /** Drawn at the strip's right end, for a control the pane itself owns. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The strip of panes over one leaf: a title per pane, and the grip that moves it.
 *
 * The drag context lives above the whole tree rather than here, so a pane can
 * leave its own strip. Shorter than the document strip, because a pane title is
 * chrome over content the reader came for rather than the thing they chose.
 */
export function PaneStrip({
  leafId,
  panes,
  activeId,
  onActivate,
  onClose,
  onMaximize,
  actions,
  className,
}: PaneStripProps) {
  const sortableIds = panes.map((pane) => tabDroppableId(leafId, pane.id));
  const caretIndex = useForeignCaretIndex(
    leafId,
    panes.map((pane) => pane.id),
  );

  return (
    <Tabs.Root
      value={activeId}
      onValueChange={(value) => onActivate(String(value))}
      className={twMerge(
        /* DS-GROUND: the strip shares the pane's ground and separates with a hairline. */
        "h-7 shrink-0 flex-row items-center gap-1 border-b border-surface-700/50 px-1 select-none",
        className,
      )}
    >
      <Tabs.List variant="plain" className="h-full min-w-0 flex-1 items-center gap-1">
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          {panes.map((pane, index) => (
            <SortableStripTab
              key={pane.id}
              leafId={leafId}
              pane={pane}
              active={pane.id === activeId}
              caretBefore={caretIndex === index}
              onClose={onClose}
              onMaximize={onMaximize}
            />
          ))}
        </SortableContext>
        {caretIndex === panes.length && <DropCaret />}
      </Tabs.List>
      {actions}
    </Tabs.Root>
  );
}

interface SortableStripTabProps {
  leafId: string;
  pane: StripPane;
  active: boolean;
  caretBefore: boolean;
  onClose?: (id: string) => void;
  onMaximize?: () => void;
}

function SortableStripTab({
  leafId,
  pane,
  active,
  caretBefore,
  onClose,
  onMaximize,
}: SortableStripTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: tabDroppableId(leafId, pane.id),
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: [transition, "background-color 150ms, color 150ms"].filter(Boolean).join(", "),
  };

  return (
    <>
      {caretBefore && <DropCaret />}
      <div
        ref={setNodeRef}
        style={style}
        data-ui="PaneStrip:tab"
        onDoubleClick={() => onMaximize?.()}
        {...listeners}
        className={twMerge(
          "group/pane relative flex h-5 max-w-56 shrink-0 touch-none items-center rounded-sm pr-0.5",
          /* The open pane rises off the strip rather than marking itself with a
             rule: DS-GROUND. */
          active && "bg-surface-800 text-surface-100",
          !active && "text-surface-400 hover:bg-surface-800/60 hover:text-surface-100",
          /* The overlay ghost is the drag preview, so the tab itself only marks
             the slot it left. */
          isDragging && "opacity-40",
        )}
      >
        <Tabs.Tab
          variant="plain"
          value={pane.id}
          className="min-w-0 shrink cursor-pointer gap-1 px-1.5 py-0 font-sans text-xs font-medium tracking-wide uppercase"
        >
          {pane.icon}
          <span className="truncate">{pane.title}</span>
        </Tabs.Tab>
        {onClose && (
          <IconButton
            icon={<XIcon weight="bold" className="h-3 w-3" />}
            variant="ghost"
            size="xs"
            compact
            onClick={() => onClose(pane.id)}
            aria-label={`Close ${pane.title}`}
            className="h-4 w-4 opacity-0 group-hover/pane:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
    </>
  );
}

function DropCaret() {
  return <span aria-hidden="true" className="h-5 w-0.5 shrink-0 rounded-full bg-accent-500" />;
}
