import { useDndContext } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SquareSplitHorizontalIcon, SquareSplitVerticalIcon, XIcon } from "@phosphor-icons/react";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

import { ContextMenu, IconButton, Tabs } from "@/components";

import { decodeDroppableId, tabDroppableId } from "../layout/dnd";

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
  /** The leaf this strip belongs to, which scopes its sortable ids across strips. */
  leafId: string;
  tabs: readonly EditorTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** The keyboard route to a split, offered from a tab's context menu. */
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  /** The strip belongs to the focused leaf, whose active tab carries the accent rail. */
  focused?: boolean;
  /** Chrome at the trailing edge, for controls that outlive any one tab. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The strip of open documents: title, dirty dot, close.
 *
 * The drag context lives above the whole grid rather than here, so a tab can
 * leave its own strip. This component keeps only the `SortableContext` that
 * animates a reorder within it.
 */
export function EditorTabs({
  leafId,
  tabs,
  activeId,
  onActivate,
  onClose,
  onSplit,
  focused,
  actions,
  className,
}: EditorTabsProps) {
  const sortableIds = tabs.map((tab) => tabDroppableId(leafId, tab.id));
  const caretIndex = useForeignCaretIndex(leafId, tabs);

  return (
    <Tabs.Root
      value={activeId}
      onValueChange={(value) => onActivate(String(value))}
      className={twMerge("h-9 shrink-0 flex-row items-center gap-1.5 px-2 select-none", className)}
    >
      <Tabs.List variant="plain" className="min-w-0 flex-1 gap-1.5 overflow-x-auto">
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => (
            <SortableTab
              key={tab.id}
              leafId={leafId}
              tab={tab}
              active={tab.id === activeId}
              focused={focused === true}
              caretBefore={caretIndex === index}
              splittable={onSplit !== undefined && tabs.length > 1}
              onSplit={onSplit}
              onClose={onClose}
            />
          ))}
        </SortableContext>
        {caretIndex === tabs.length && <DropCaret />}
      </Tabs.List>

      {actions && (
        <div data-ui="EditorTabs:actions" className="flex shrink-0 items-center gap-1 pl-1.5">
          {actions}
        </div>
      )}
    </Tabs.Root>
  );
}

/**
 * Where a tab dragged in from another strip would land, or null.
 *
 * A reorder within the strip previews through the sortable transforms instead,
 * so the caret only answers a foreign drag: before the hovered tab, or at the
 * end for a drop on the leaf's centre.
 */
function useForeignCaretIndex(leafId: string, tabs: readonly EditorTab[]): number | null {
  const { active, over } = useDndContext();
  const dragged = active ? decodeDroppableId(String(active.id)) : null;
  if (dragged?.kind !== "tab" || dragged.leafId === leafId) return null;

  const target = over ? decodeDroppableId(String(over.id)) : null;
  if (!target || target.leafId !== leafId) return null;

  if (target.kind === "tab") {
    const index = tabs.findIndex((tab) => tab.id === target.documentId);
    return index < 0 ? null : index;
  }
  return target.region === "center" ? tabs.length : null;
}

function DropCaret() {
  return <span aria-hidden="true" className="h-4 w-0.5 shrink-0 rounded-full bg-accent-500" />;
}

interface SortableTabProps {
  leafId: string;
  tab: EditorTab;
  active: boolean;
  focused: boolean;
  caretBefore: boolean;
  splittable: boolean;
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  onClose: (id: string) => void;
}

const SortableTab = memo(function SortableTab({
  leafId,
  tab,
  active,
  focused,
  caretBefore,
  splittable,
  onSplit,
  onClose,
}: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: tabDroppableId(leafId, tab.id),
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

  const body = (
    <>
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

      {active && focused && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-500" />
      )}
    </>
  );

  const tabProps = {
    ref: setNodeRef,
    style,
    "data-ui": "EditorTabs:tab",
    onAuxClick: handleAuxClick,
    ...listeners,
    className: twMerge(
      /* Hidden overflow clips the focus rail to the pill's rounded corners, so
         edge to edge means the silhouette's edges rather than past them. */
      "group/tab relative flex h-6 max-w-56 shrink-0 touch-none items-center overflow-hidden rounded-md pr-1",
      /* The open document rises off the strip rather than marking
         itself with a rule: DS-GROUND. */
      active && "bg-surface-800 text-surface-100",
      !active && "text-surface-300 hover:bg-surface-800/60 hover:text-surface-100",
      /* The overlay ghost is the drag preview, so the tab itself only marks
         the slot it left. */
      isDragging && "opacity-40",
    ),
  };

  if (!onSplit) {
    return (
      <>
        {caretBefore && <DropCaret />}
        <div {...tabProps}>{body}</div>
      </>
    );
  }

  return (
    <>
      {caretBefore && <DropCaret />}
      <ContextMenu.Root>
        <ContextMenu.Trigger render={<div {...tabProps} />}>{body}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
              <ContextMenu.Item
                icon={<SquareSplitHorizontalIcon className="h-4 w-4" />}
                disabled={!splittable}
                onClick={() => onSplit(tab.id, "right")}
              >
                Split right
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<SquareSplitVerticalIcon className="h-4 w-4" />}
                disabled={!splittable}
                onClick={() => onSplit(tab.id, "bottom")}
              >
                Split down
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
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
