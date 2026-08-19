import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { XIcon } from "@phosphor-icons/react";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Tabs } from "@/components";
import { restrictToHorizontalAxis } from "@/utils";

export interface EditorTab {
  id: string;
  title: string;
  /** Dim text after the title, saying where the document lives. */
  context?: string;
  icon?: ReactNode;
  /** Unsaved edits: the close button reads as a dot until it is hovered. */
  dirty?: boolean;
}

export interface EditorTabsProps {
  tabs: readonly EditorTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Drag to reorder, given the whole strip in its new order. Absent pins the tabs. */
  onReorder?: (ids: string[]) => void;
  /** Chrome at the trailing edge, for controls that outlive any one tab. */
  actions?: ReactNode;
  className?: string;
}

/** The strip of open documents: title, dirty dot, close. */
export function EditorTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  actions,
  className,
}: EditorTabsProps) {
  /* Below the threshold the gesture stays a click, so a tab still activates and
     its close button still fires without a drag starting under them. */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ids = tabs.map((tab) => tab.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    onReorder?.(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <Tabs.Root
      value={activeId}
      onValueChange={(value) => onActivate(String(value))}
      className={twMerge(
        "h-9 shrink-0 flex-row items-center gap-1.5 rounded-t-xl border-x border-t border-surface-700 px-2 select-none",
        className,
      )}
    >
      <Tabs.List variant="plain" className="min-w-0 flex-1 gap-1.5 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                sortable={onReorder !== undefined}
                onClose={onClose}
              />
            ))}
          </SortableContext>
        </DndContext>
      </Tabs.List>

      {actions && (
        <div data-ui="EditorTabs:actions" className="flex shrink-0 items-center gap-1 pl-1.5">
          {actions}
        </div>
      )}
    </Tabs.Root>
  );
}

interface SortableTabProps {
  tab: EditorTab;
  active: boolean;
  sortable: boolean;
  onClose: (id: string) => void;
}

const SortableTab = memo(function SortableTab({
  tab,
  active,
  sortable,
  onClose,
}: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !sortable,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    /* An inline transition replaces the class rather than joining it, so the
       color fade is spelled out here beside the one the sort needs. */
    transition: [transition, "background-color 150ms, color 150ms"].filter(Boolean).join(", "),
  };

  function handleAuxClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose(tab.id);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-ui="EditorTabs:tab"
      onAuxClick={handleAuxClick}
      {...listeners}
      className={twMerge(
        "group/tab relative flex h-6 max-w-56 shrink-0 touch-none items-center rounded-md pr-1",
        /* The open document rises off the strip rather than marking
           itself with a rule: DS-GROUND. */
        active && "bg-surface-800 text-surface-100",
        !active && "text-surface-300 hover:bg-surface-800/60 hover:text-surface-100",
        /* The tab is its own drag preview, so it takes a surface of its own to
           travel over its neighbours rather than through them. */
        isDragging && "z-20 bg-surface-800 shadow-md",
      )}
    >
      <Tabs.Tab
        variant="plain"
        value={tab.id}
        className="min-w-0 cursor-pointer gap-1.5 py-1 pr-1 pl-2 text-xs"
      >
        {tab.icon}
        <span className="truncate">{tab.title}</span>
        {tab.context && (
          <span className="truncate text-[11px] text-surface-400">{tab.context}</span>
        )}
      </Tabs.Tab>

      <IconButton
        icon={<CloseGlyph dirty={tab.dirty} />}
        variant="ghost"
        size="xs"
        compact
        onClick={() => onClose(tab.id)}
        aria-label={`Close ${tab.title}`}
        className={twMerge(
          /* Out of flow, so revealing it never resizes the strip. The fill
             arrives with it, to mask the label it now covers. */
          "absolute top-1/2 right-1 z-10 h-5 w-5 -translate-y-1/2 opacity-0 transition-opacity",
          "group-hover/tab:bg-surface-800 group-hover/tab:opacity-100 hover:bg-surface-700",
          "focus-visible:opacity-100",
          tab.dirty && "opacity-100",
        )}
      />
    </div>
  );
});

function CloseGlyph({ dirty }: { dirty?: boolean }) {
  if (!dirty) return <XIcon weight="bold" className="h-3 w-3" />;

  return (
    <>
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current group-hover/tab:hidden" />
      <XIcon weight="bold" className="hidden h-3 w-3 group-hover/tab:block" />
    </>
  );
}
