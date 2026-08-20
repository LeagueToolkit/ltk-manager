import { useDndContext } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLineRightIcon,
  CopyIcon,
  PathIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
  XCircleIcon,
  XIcon,
  XSquareIcon,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import { twMerge } from "tailwind-merge";

import { ContextMenu, IconButton, Tabs } from "@/components";
import { useCopyToClipboard, useHorizontalWheel } from "@/hooks";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";

import { decodeDroppableId, tabDroppableId } from "../layout/dnd";

export interface EditorTab {
  id: string;
  title: string;
  /** Dim text after the title, saying where the document lives. */
  context?: string;
  /** What Copy path writes. Absent for a document no path addresses. */
  path?: string;
  icon?: ReactNode;
  /** Unsaved edits: the close button reads as a dot until it is hovered. */
  dirty?: boolean;
  /** The ephemeral tab, which the next open from a tree replaces. */
  preview?: boolean;
}

export interface EditorTabsProps {
  /** The leaf this strip belongs to, which scopes its sortable ids across strips. */
  leafId: string;
  tabs: readonly EditorTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Closes every tab of this strip but the one named. */
  onCloseOthers?: (id: string) => void;
  /** Closes every tab of this strip after the one named. */
  onCloseToRight?: (id: string) => void;
  /** Closes every tab of this strip. */
  onCloseAll?: () => void;
  /** The keyboard route to a split, offered from a tab's context menu. */
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  /** A double click on a tab, which keeps an ephemeral one. */
  onPromote?: (id: string) => void;
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
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onSplit,
  onPromote,
  focused,
  actions,
  className,
}: EditorTabsProps) {
  const sortableIds = tabs.map((tab) => tabDroppableId(leafId, tab.id));
  const caretIndex = useForeignCaretIndex(leafId, tabs);

  const listRef = useRef<HTMLDivElement>(null);
  useHorizontalWheel(listRef);
  useActiveTabInView(listRef, activeId);

  return (
    <Tabs.Root
      value={activeId}
      onValueChange={(value) => onActivate(String(value))}
      className={twMerge("h-9 shrink-0 flex-row items-center select-none", className)}
    >
      {/* The strip's inset belongs to the scroll container rather than around
          it, so its track runs the full width and ends against the panel's own
          edge instead of stopping short of it. `scroll` rather than `auto`
          because a track that comes and goes takes its 4px out of this box
          each time, which walks the tabs up and down as tabs are opened. */}
      <Tabs.List
        ref={listRef}
        variant="plain"
        className="hairline-scrollbars h-full min-w-0 flex-1 items-end gap-1.5 overflow-x-scroll px-2"
        {...NO_OVERSCROLL}
      >
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
              alone={tabs.length === 1}
              last={index === tabs.length - 1}
              onSplit={onSplit}
              onPromote={onPromote}
              onClose={onClose}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onCloseAll={onCloseAll}
            />
          ))}
        </SortableContext>
        {caretIndex === tabs.length && <DropCaret />}
      </Tabs.List>

      {actions && (
        <div data-ui="EditorTabs:actions" className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      )}
    </Tabs.Root>
  );
}

/**
 * Keeps the active tab on screen, which is what reveals a newly opened one.
 *
 * A tab opens at the end of the strip, past the edge once the strip is full, so
 * without this the document a user just asked for is the one they cannot see.
 * `nearest` on both axes moves only what has to move, so a tab already in view
 * costs nothing and no ancestor scrolls along with it.
 */
function useActiveTabInView(ref: RefObject<HTMLDivElement | null>, activeId: string | null) {
  useEffect(() => {
    if (activeId === null) return;

    const tabs = ref.current?.querySelectorAll<HTMLElement>("[data-tab-id]");
    const tab = tabs && [...tabs].find((candidate) => candidate.dataset.tabId === activeId);
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [ref, activeId]);
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
  return <span aria-hidden="true" className="h-7 w-0.5 shrink-0 rounded-full bg-accent-500" />;
}

interface SortableTabProps {
  leafId: string;
  tab: EditorTab;
  active: boolean;
  focused: boolean;
  caretBefore: boolean;
  splittable: boolean;
  /** The strip holds this tab alone, so there is nothing else to close. */
  alone: boolean;
  /** Nothing sits after this tab, so there is nothing to its right to close. */
  last: boolean;
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  onPromote?: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onCloseAll?: () => void;
}

const SortableTab = memo(function SortableTab({
  leafId,
  tab,
  active,
  focused,
  caretBefore,
  splittable,
  alone,
  last,
  onSplit,
  onPromote,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
}: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: tabDroppableId(leafId, tab.id),
  });
  const copy = useCopyToClipboard();

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
        /* `shrink` beats the base tab's `shrink-0`, without which the strip's
           max width clips the label rather than eliding it. */
        className="min-w-0 shrink cursor-pointer gap-1.5 py-1 pr-1 pl-2 text-xs"
      >
        {tab.icon}
        <span className={twMerge("truncate", tab.preview && "italic")}>{tab.title}</span>
        {tab.context && (
          <span className="shrink-[3] truncate text-[11px] text-surface-400">{tab.context}</span>
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
    /* What the strip scrolls to when this tab becomes the active one. Its own
       attribute, because `data-ui` is a label for a reader and not a hook. */
    "data-tab-id": tab.id,
    onAuxClick: handleAuxClick,
    onDoubleClick: () => onPromote?.(tab.id),
    ...listeners,
    className: twMerge(
      /* Hidden overflow clips the focus rail to the pill's rounded corners, so
         edge to edge means the silhouette's edges rather than past them. */
      "group/tab relative flex h-7 max-w-56 shrink-0 touch-none items-center overflow-hidden rounded-md pr-1",
      /* The open document rises off the strip rather than marking
         itself with a rule: DS-GROUND. */
      active && "bg-surface-800 text-surface-100",
      !active && "text-surface-300 hover:bg-surface-800/60 hover:text-surface-100",
      /* The overlay ghost is the drag preview, so the tab itself only marks
         the slot it left. */
      isDragging && "opacity-40",
    ),
  };

  return (
    <>
      {caretBefore && <DropCaret />}
      <ContextMenu.Root>
        <ContextMenu.Trigger render={<div {...tabProps} />}>{body}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className="w-52">
              <ContextMenu.Item
                icon={<XIcon className="h-4 w-4" />}
                onClick={() => onClose(tab.id)}
              >
                Close
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<XSquareIcon className="h-4 w-4" />}
                disabled={alone || !onCloseOthers}
                onClick={() => onCloseOthers?.(tab.id)}
              >
                Close Others
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<ArrowLineRightIcon className="h-4 w-4" />}
                disabled={last || !onCloseToRight}
                onClick={() => onCloseToRight?.(tab.id)}
              >
                Close to the Right
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<XCircleIcon className="h-4 w-4" />}
                disabled={!onCloseAll}
                onClick={() => onCloseAll?.()}
              >
                Close All
              </ContextMenu.Item>

              <ContextMenu.Separator />

              <ContextMenu.Item
                icon={<PathIcon className="h-4 w-4" />}
                disabled={tab.path === undefined}
                onClick={() => tab.path !== undefined && void copy(tab.path, "path")}
              >
                Copy Path
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<CopyIcon className="h-4 w-4" />}
                onClick={() => void copy(tab.title, "name")}
              >
                Copy Name
              </ContextMenu.Item>

              {onSplit && (
                <>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    icon={<SquareSplitHorizontalIcon className="h-4 w-4" />}
                    disabled={!splittable}
                    onClick={() => onSplit(tab.id, "right")}
                  >
                    Split Right
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    icon={<SquareSplitVerticalIcon className="h-4 w-4" />}
                    disabled={!splittable}
                    onClick={() => onSplit(tab.id, "bottom")}
                  >
                    Split Down
                  </ContextMenu.Item>
                </>
              )}
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
