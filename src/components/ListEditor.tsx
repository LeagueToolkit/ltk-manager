import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { type ButtonSize, IconButton } from "./Button";
import { ContextMenu } from "./ContextMenu";
import { Tooltip } from "./Tooltip";

type PerItem<T, V> = V | ((item: T) => V);

function resolve<T, V>(value: PerItem<T, V>, item: T): V {
  if (typeof value === "function") return (value as (item: T) => V)(item);
  return value;
}

/** `rows` for entries with more to say than their name, `wrap` for short values that read as tags. */
export type ListEditorLayout = "rows" | "wrap";

interface LayoutStyles {
  list: string;
  /** Sits on the `li`, which is the flex item the layout sizes. */
  slot: string;
  item: string;
  content: string;
  editor: string;
  /** How a non-pinned action rests, before hover or focus brings it to full strength. */
  reveal: string;
  actionSize: ButtonSize;
}

const LAYOUTS: Record<ListEditorLayout, LayoutStyles> = {
  rows: {
    list: "flex flex-col gap-0.5",
    slot: "",
    item: "flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-800 focus-within:bg-surface-800",
    content: "min-w-0 flex-1",
    editor: "rounded-lg bg-surface-800 px-2 py-2",
    /* A row is wide enough that its controls at rest are noise, and hiding them costs no layout. */
    reveal: "opacity-0",
    actionSize: "sm",
  },
  wrap: {
    list: "flex flex-wrap gap-1.5",
    slot: "max-w-full min-w-0",
    item: "flex items-center gap-1 rounded-md bg-surface-800 py-1 pr-1 pl-2 hover:bg-surface-700 focus-within:bg-surface-700",
    content: "min-w-0",
    editor: "rounded-md bg-surface-800 px-2 py-1",
    /* A chip is only as wide as its contents, so an action that appears on hover would reflow the wrap. */
    reveal: "opacity-50",
    actionSize: "xs",
  },
};

export interface ListEditorAction<T> {
  icon: PerItem<T, ReactNode>;
  /** Tooltip, `aria-label` and context menu wording all come from here. */
  label: PerItem<T, string>;
  onSelect: (item: T) => void;
  variant?: "default" | "danger";
  /** `leading` sits in the left gutter, for state the row owns rather than an act upon it. */
  placement?: "leading" | "trailing";
  /** Full strength at rest, for state a row has to show whether or not it is pointed at. */
  pinned?: (item: T) => boolean;
  hidden?: (item: T) => boolean;
}

export interface ListEditorProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Defaults to `rows`. */
  layout?: ListEditorLayout;
  /** Takes over the entry whose key matches `editingKey`, which suppresses its actions and click target. */
  renderEditor?: (item: T) => ReactNode;
  editingKey?: string | null;
  actions?: ListEditorAction<T>[];
  /** Clicking an entry's content - the fast way into `renderEditor`, with an action as the reachable equivalent. */
  onActivate?: (item: T) => void;
  /** Stands in for the list while there is nothing in it. */
  empty?: ReactNode;
  /** A count, a bulk action, or an add field, below the list and outside its hover targets. */
  footer?: ReactNode;
  className?: string;
}

/**
 * A list of entries you can act on, where the actions stay out of the way until
 * you point at one.
 *
 * Entries read as data at rest. Per-entry controls live in a rail that comes up
 * to full strength on hover or keyboard focus, so a list of ten does not draw
 * ten trash cans, and every action is also on the entry's context menu.
 */
export function ListEditor<T>({
  items,
  itemKey,
  renderItem,
  layout = "rows",
  renderEditor,
  editingKey,
  actions = [],
  onActivate,
  empty,
  footer,
  className,
}: ListEditorProps<T>) {
  return (
    <div className={twMerge("flex flex-col gap-3 select-none", className)}>
      <ListEditorBody
        items={items}
        itemKey={itemKey}
        renderItem={renderItem}
        layout={layout}
        renderEditor={renderEditor}
        editingKey={editingKey}
        actions={actions}
        onActivate={onActivate}
        empty={empty}
      />
      {footer}
    </div>
  );
}

function ListEditorBody<T>({
  items,
  itemKey,
  renderItem,
  layout,
  renderEditor,
  editingKey,
  actions,
  onActivate,
  empty,
}: Omit<ListEditorProps<T>, "footer" | "className" | "layout"> & {
  actions: ListEditorAction<T>[];
  layout: ListEditorLayout;
}) {
  if (items.length === 0) return <>{empty}</>;

  return (
    <ul className={LAYOUTS[layout].list}>
      {items.map((item) => (
        <ListEditorEntry
          key={itemKey(item)}
          item={item}
          editing={editingKey === itemKey(item)}
          renderItem={renderItem}
          layout={layout}
          renderEditor={renderEditor}
          actions={actions}
          onActivate={onActivate}
        />
      ))}
    </ul>
  );
}

interface ListEditorEntryProps<T> {
  item: T;
  editing: boolean;
  renderItem: (item: T) => ReactNode;
  layout: ListEditorLayout;
  renderEditor?: (item: T) => ReactNode;
  actions: ListEditorAction<T>[];
  onActivate?: (item: T) => void;
}

function ListEditorEntry<T>({
  item,
  editing,
  renderItem,
  layout,
  renderEditor,
  actions,
  onActivate,
}: ListEditorEntryProps<T>) {
  const styles = LAYOUTS[layout];

  if (editing && renderEditor) {
    return <li className={twMerge(styles.slot, styles.editor)}>{renderEditor(item)}</li>;
  }

  const visible = actions.filter((action) => !action.hidden?.(item));
  const leading = visible.filter((action) => action.placement === "leading");
  const trailing = visible.filter((action) => action.placement !== "leading");

  function handleClick() {
    if (!onActivate) return;
    /* A drag that ends on the entry is a selection of its text, not a click into the editor. */
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    onActivate(item);
  }

  const entry = (
    <div
      className={twMerge("group transition-colors", styles.item, onActivate && "cursor-pointer")}
      onClick={handleClick}
    >
      <EntryActions actions={leading} item={item} layout={layout} />
      <div className={styles.content}>{renderItem(item)}</div>
      <EntryActions actions={trailing} item={item} layout={layout} />
    </div>
  );

  if (visible.length === 0) return <li className={styles.slot}>{entry}</li>;

  return (
    <li className={styles.slot}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>{entry}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
              {visible.map((action) => (
                <ContextMenu.Item
                  key={resolve(action.label, item)}
                  icon={resolve(action.icon, item)}
                  variant={action.variant}
                  onClick={() => action.onSelect(item)}
                >
                  {resolve(action.label, item)}
                </ContextMenu.Item>
              ))}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );
}

interface EntryActionsProps<T> {
  actions: ListEditorAction<T>[];
  item: T;
  layout: ListEditorLayout;
}

function EntryActions<T>({ actions, item, layout }: EntryActionsProps<T>) {
  if (actions.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {actions.map((action, index) => (
        <EntryAction key={index} action={action} item={item} layout={layout} />
      ))}
    </div>
  );
}

interface EntryActionProps<T> {
  action: ListEditorAction<T>;
  item: T;
  layout: ListEditorLayout;
}

function EntryAction<T>({ action, item, layout }: EntryActionProps<T>) {
  const styles = LAYOUTS[layout];
  const label = resolve(action.label, item);
  const pinned = action.pinned?.(item) ?? false;

  return (
    <Tooltip content={label} delay={400}>
      <IconButton
        icon={resolve(action.icon, item)}
        variant="ghost"
        size={styles.actionSize}
        compact
        aria-label={label}
        className={twMerge(
          "transition-opacity",
          !pinned &&
            `${styles.reveal} group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100`,
          action.variant === "danger" && "hover:text-danger-text",
        )}
        onClick={(event) => {
          event.stopPropagation();
          action.onSelect(item);
        }}
      />
    </Tooltip>
  );
}
