import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLineRightIcon,
  CopyIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PathIcon,
  PushPinIcon,
  PushPinSlashIcon,
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

import { ContextMenu, IconButton, Tabs } from "@/components";
import { useCopyToClipboard, useHorizontalWheel } from "@/hooks";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { tabDroppableId } from "../layout/dnd";
import { useForeignCaretIndex } from "../layout/useForeignCaretIndex";

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
  /** Pinned: the tab leads the strip, and the closes of a batch pass it over. */
  pinned?: boolean;
  /** What the document puts above the strip's own items in this tab's menu. */
  menu?: ReactNode;
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
  /** Absent leaves the strip without a pin, for a host whose tabs are all alike. */
  onTogglePin?: (id: string, pinned: boolean) => void;
  /** This group takes a document only from a gesture that names it. */
  locked?: boolean;
  /** Absent leaves the strip without a lock, for a host whose groups all take an open. */
  onToggleLock?: (locked: boolean) => void;
  /** A double click on a kept tab, which fills the grid with this leaf. */
  onMaximize?: () => void;
  /** The strip belongs to the focused leaf, whose active tab carries the accent rail. */
  focused?: boolean;
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
  onTogglePin,
  locked,
  onToggleLock,
  onMaximize,
  focused,
  className,
}: EditorTabsProps) {
  const sortableIds = tabs.map((tab) => tabDroppableId(leafId, tab.id));
  const pinnedCount = tabs.filter((tab) => tab.pinned === true).length;
  const caretIndex = useForeignCaretIndex(
    leafId,
    tabs.map((tab) => tab.id),
  );

  const listRef = useRef<HTMLDivElement>(null);
  useHorizontalWheel(listRef);
  useActiveTabInView(listRef, activeId);

  return (
    <Tabs.Root
      value={activeId}
      onValueChange={(value) => onActivate(String(value))}
      className={twMerge(
        /* DS-GROUND: the strip shares the editor's ground and separates with a hairline. */
        "group/strip h-9 shrink-0 flex-row items-center border-b border-surface-700/50 select-none",
        className,
      )}
    >
      {/* The strip's inset belongs to the scroll container rather than around
          it, so its track runs the full width and ends against the panel's own
          edge instead of stopping short of it. `scroll` rather than `auto`
          because a track that comes and goes takes its 6px out of this box
          each time, which walks the tabs up and down as tabs are opened. */}
      <Tabs.List
        ref={listRef}
        variant="plain"
        className="h-full min-w-0 flex-1 items-end gap-1.5 overflow-x-scroll px-2 scrollbar-sm"
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
              othersClosable={closable(tabs, (other) => other.id !== tab.id)}
              rightClosable={closable(tabs.slice(index + 1))}
              allClosable={closable(tabs)}
              dividerAfter={index === pinnedCount - 1 && pinnedCount < tabs.length}
              locked={locked === true}
              onSplit={onSplit}
              onPromote={onPromote}
              onTogglePin={onTogglePin}
              onToggleLock={onToggleLock}
              onMaximize={onMaximize}
              onClose={onClose}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onCloseAll={onCloseAll}
            />
          ))}
        </SortableContext>
        {caretIndex === tabs.length && <DropCaret />}
      </Tabs.List>
      {/* Outside the scroll lane, so a strip too full to fit still shows it, and
          only over a strip with tabs, where a lock has something to hold. */}
      {onToggleLock && tabs.length > 0 && (
        <LockToggle locked={locked === true} onToggle={onToggleLock} />
      )}
    </Tabs.Root>
  );
}

/**
 * A batch close has work: one of these tabs is unpinned.
 *
 * A pin is what a batch close passes over, so an item whose whole batch is
 * pinned would do nothing and reads as disabled instead.
 */
function closable(tabs: readonly EditorTab[], among: (tab: EditorTab) => boolean = () => true) {
  return tabs.some((tab) => tab.pinned !== true && among(tab));
}

interface LockToggleProps {
  locked: boolean;
  onToggle: (locked: boolean) => void;
}

/* Revealed on hover the way a tab's close is, and kept on while it is locked,
   which is the only mark the strip carries for a state the tabs cannot show. */
function LockToggle({ locked, onToggle }: LockToggleProps) {
  const label = locked ? m.editor_group_unlock_action() : m.editor_group_lock_action();

  return (
    <IconButton
      icon={<LockGlyph closed={locked} weight="bold" />}
      variant="ghost"
      size="xs"
      compact
      title={label}
      aria-label={label}
      aria-pressed={locked}
      onClick={() => onToggle(!locked)}
      className={twMerge(
        "mr-2 h-6 w-6 shrink-0 opacity-0 transition-opacity",
        "group-hover/strip:opacity-100 focus-visible:opacity-100",
        locked && "text-accent-400 opacity-100",
      )}
    />
  );
}

/* The gesture on offer rather than the state, the way the lock item is: a tab
   that is not pinned shows the pin its item would give it. */
function PinGlyph({ pinned }: { pinned: boolean }) {
  if (pinned) return <PushPinSlashIcon className="h-4 w-4" />;
  return <PushPinIcon className="h-4 w-4" />;
}

interface LockGlyphProps {
  /** The shackle is down, which is the group holding rather than the gesture offered. */
  closed: boolean;
  weight?: "regular" | "bold";
}

function LockGlyph({ closed, weight = "regular" }: LockGlyphProps) {
  if (closed) return <LockSimpleIcon weight={weight} className="h-4 w-4" />;
  return <LockSimpleOpenIcon weight={weight} className="h-4 w-4" />;
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
  /** Close Others would close something. */
  othersClosable: boolean;
  /** Close to the Right would close something. */
  rightClosable: boolean;
  /** Close All would close something. */
  allClosable: boolean;
  /** This tab ends the pinned run, so the divider between the two follows it. */
  dividerAfter: boolean;
  locked: boolean;
  onSplit?: (id: string, edge: "right" | "bottom") => void;
  onPromote?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onToggleLock?: (locked: boolean) => void;
  onMaximize?: () => void;
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
  othersClosable,
  rightClosable,
  allClosable,
  dividerAfter,
  locked,
  onSplit,
  onPromote,
  onTogglePin,
  onToggleLock,
  onMaximize,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
}: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: tabDroppableId(leafId, tab.id),
  });
  const copy = useCopyToClipboard();
  const pinned = tab.pinned === true;
  const lockLabel = locked ? m.editor_group_unlock_action() : m.editor_group_lock_action();
  const pinLabel = pinned ? m.editor_tab_unpin_action() : m.editor_tab_pin_action();

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    /* An inline transition replaces the class rather than joining it, so the
       color fade is spelled out here beside the one the sort needs. */
    transition: [transition, "background-color 150ms, color 150ms"].filter(Boolean).join(", "),
  };

  /* A pinned tab answers the middle click with nothing. The gesture is quick
     and undoable nowhere, which is what the pin was asked to guard against. */
  function handleAuxClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 1) return;
    event.preventDefault();
    if (!pinned) onClose(tab.id);
  }

  /* A replaceable tab spends the double click on being kept, per "Preview tabs"
     in `docs/ux/PROJECT_EDITOR.md`. */
  function handleDoubleClick() {
    if (tab.preview) onPromote?.(tab.id);
    else onMaximize?.();
  }

  const body = (
    <>
      <Tabs.Tab
        variant="plain"
        value={tab.id}
        /* `shrink` beats the base tab's `shrink-0`, without which the strip's
           max width clips the label rather than eliding it. */
        className="min-w-0 shrink cursor-pointer gap-1.5 py-0.5 pr-1 pl-0.5 text-xs"
      >
        {tab.icon && <TabGlyph>{tab.icon}</TabGlyph>}
        <span className={twMerge("truncate", tab.preview && "italic")}>{tab.title}</span>
        {tab.context && (
          <span className="shrink-[3] truncate text-[0.6875rem] text-surface-400">
            {tab.context}
          </span>
        )}
      </Tabs.Tab>

      <TrailingButton pinned={pinned} tab={tab} onClose={onClose} onTogglePin={onTogglePin} />

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
    onDoubleClick: handleDoubleClick,
    ...listeners,
    className: twMerge(
      /* Hidden overflow clips the focus rail to the pill's rounded corners, so
         edge to edge means the silhouette's edges rather than past them. The
         bottom pad is the rail's own room, which it otherwise takes out of
         the gap under the label.

         The height is what the strip has left to give: 36px less the scroll
         lane's 6px is 30, so a 24px tab bottom-aligns with the same 6px above
         it as the lane leaves below. */
      "group/tab relative flex h-6 max-w-56 shrink-0 touch-none items-center overflow-hidden rounded-md pr-1 pb-0.5",
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
            <ContextMenu.Popup className="w-60">
              {tab.menu && (
                <>
                  {tab.menu}
                  <ContextMenu.Separator />
                </>
              )}
              {onTogglePin && (
                <>
                  <ContextMenu.Item
                    icon={<PinGlyph pinned={pinned} />}
                    onClick={() => onTogglePin(tab.id, !pinned)}
                  >
                    {pinLabel}
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                </>
              )}

              <ContextMenu.Item
                icon={<XIcon className="h-4 w-4" />}
                onClick={() => onClose(tab.id)}
              >
                {m.editor_tab_close_action()}
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<XSquareIcon className="h-4 w-4" />}
                disabled={!othersClosable || !onCloseOthers}
                onClick={() => onCloseOthers?.(tab.id)}
              >
                {m.editor_tab_close_others_action()}
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<ArrowLineRightIcon className="h-4 w-4" />}
                disabled={!rightClosable || !onCloseToRight}
                onClick={() => onCloseToRight?.(tab.id)}
              >
                {m.editor_tab_close_right_action()}
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<XCircleIcon className="h-4 w-4" />}
                disabled={!allClosable || !onCloseAll}
                onClick={() => onCloseAll?.()}
              >
                {m.editor_tab_close_all_action()}
              </ContextMenu.Item>

              <ContextMenu.Separator />

              <ContextMenu.Item
                icon={<PathIcon className="h-4 w-4" />}
                disabled={tab.path === undefined}
                onClick={() => tab.path !== undefined && void copy(tab.path, "path")}
              >
                {m.editor_tab_copy_path_action()}
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<CopyIcon className="h-4 w-4" />}
                onClick={() => void copy(tab.title, "name")}
              >
                {m.editor_tab_copy_name_action()}
              </ContextMenu.Item>

              {onSplit && (
                <>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    icon={<SquareSplitHorizontalIcon className="h-4 w-4" />}
                    disabled={!splittable}
                    onClick={() => onSplit(tab.id, "right")}
                  >
                    {m.editor_tab_split_right_action()}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    icon={<SquareSplitVerticalIcon className="h-4 w-4" />}
                    disabled={!splittable}
                    onClick={() => onSplit(tab.id, "bottom")}
                  >
                    {m.editor_tab_split_down_action()}
                  </ContextMenu.Item>
                </>
              )}

              {onToggleLock && (
                <>
                  <ContextMenu.Separator />
                  {/* The glyph is the gesture on offer rather than the state, so an
                      unlocked group shows the shut padlock its item would give it. */}
                  <ContextMenu.Item
                    icon={<LockGlyph closed={!locked} />}
                    onClick={() => onToggleLock(!locked)}
                  >
                    {lockLabel}
                  </ContextMenu.Item>
                </>
              )}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {dividerAfter && <PinnedDivider />}
    </>
  );
});

/* The seam between the pinned run and the rest of the strip. Its own element
   rather than a border on the tab, so the gap stays even on both sides of it
   and a tab dragged past it never carries the rule along. */
function PinnedDivider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-surface-700" />;
}

interface TrailingButtonProps {
  tab: EditorTab;
  pinned: boolean;
  onClose: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
}

/**
 * The one control at the tab's right end: unpin while pinned, close otherwise.
 *
 * A pinned tab gives up its close the way Visual Studio Code's does, so the
 * gesture that sits under the pointer is the one that gets the tab back rather
 * than the one that loses it. Closing a pinned tab stays in the menu.
 */
function TrailingButton({ tab, pinned, onClose, onTogglePin }: TrailingButtonProps) {
  /* Out of flow, so revealing it never resizes the strip. The fill arrives with
     it, to mask the label it now covers. */
  const className = twMerge(
    "absolute top-0 right-1 bottom-0.5 z-10 my-auto h-5 w-5 opacity-0 transition-opacity",
    "group-hover/tab:bg-surface-800 group-hover/tab:opacity-100 hover:bg-surface-700",
    "focus-visible:opacity-100",
    (tab.dirty === true || pinned) && "opacity-100",
  );

  if (pinned && onTogglePin) {
    return (
      <IconButton
        icon={<PushPinIcon weight="fill" className="h-3 w-3" />}
        variant="ghost"
        size="xs"
        compact
        onClick={() => onTogglePin(tab.id, false)}
        title={m.editor_tab_unpin_label({ title: tab.title })}
        aria-label={m.editor_tab_unpin_label({ title: tab.title })}
        className={className}
      />
    );
  }

  return (
    <IconButton
      icon={<CloseGlyph dirty={tab.dirty} />}
      variant="ghost"
      size="xs"
      compact
      onClick={() => onClose(tab.id)}
      aria-label={m.editor_tab_close_label({ title: tab.title })}
      className={className}
    />
  );
}

function CloseGlyph({ dirty }: { dirty?: boolean }) {
  if (!dirty) return <XIcon weight="bold" className="h-3 w-3" />;

  return (
    <>
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current group-hover/tab:hidden" />
      <XIcon weight="bold" className="hidden h-3 w-3 group-hover/tab:block" />
    </>
  );
}

/**
 * A document glyph sized against the tab rather than the registry that mints it.
 *
 * One registry answers every surface that names a document, and the command
 * palette wants a glyph that sits beside a line of text. On a tab the glyph is
 * what the eye finds first, so it takes the pill's height rather than the
 * label's.
 */
export function TabGlyph({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center [&_svg]:h-5 [&_svg]:w-5">{children}</span>;
}
