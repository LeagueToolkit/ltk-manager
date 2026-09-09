import { FolderDashedIcon, FolderIcon, FolderOpenIcon } from "@phosphor-icons/react";

import { Spinner } from "@/components";
import { twMerge } from "@/utils";

/* The layer file tree's row styling, shared by every read-only tree of the editor.
   Selected-hover has to beat plain hover, so it appears later in the string. */
export const TREE_ROW_BASE_CLASSES =
  "flex items-center gap-1 pr-3 select-none text-surface-200/90 outline-none transition-colors duration-100";
export const TREE_ROW_STATE_CLASSES =
  "hover:bg-surface-700/70 hover:text-surface-100 " +
  "aria-selected:bg-accent-500/15 aria-selected:text-accent-100 " +
  "aria-selected:hover:bg-accent-500/25 " +
  "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-500/70";

const RAIL_CLASSES = "w-[10px] shrink-0 self-stretch";

/**
 * One column per ancestor level, each drawing a 1px vertical guide.
 *
 * The first column stays blank. A root entry's guide never doubles the pane's own edge.
 */
export function IndentRails({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      <span aria-hidden="true" className={RAIL_CLASSES} />
      {Array.from({ length: depth - 1 }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={twMerge(RAIL_CLASSES, "border-l border-surface-700/60")}
        />
      ))}
    </>
  );
}

/** The caret's slot, reserved. Names stay column-aligned across the row kinds. */
export function CaretSlot() {
  return <span aria-hidden="true" className="h-3 w-3 shrink-0" />;
}

interface FolderGlyphProps {
  /** The group of the entries no table names. */
  unknown: boolean;
  isExpanded: boolean;
}

/* DS-KIND-HUE */
const FOLDER_CLASSES = "h-3.5 w-3.5 shrink-0 text-folder-text";

/** A directory row's filled folder, dashed and dimmed for the unnamed group. */
export function FolderGlyph({ unknown, isExpanded }: FolderGlyphProps) {
  if (unknown) {
    return <FolderDashedIcon weight="fill" className={twMerge(FOLDER_CLASSES, "opacity-60")} />;
  }
  if (isExpanded) return <FolderOpenIcon weight="fill" className={FOLDER_CLASSES} />;
  return <FolderIcon weight="fill" className={FOLDER_CLASSES} />;
}

interface TreeLoadingRowProps {
  depth: number;
  height: number;
  rowIndex: number;
  tabIndex: number;
  label: string;
  /** The `data-ui` the tree names its rows by. */
  dataUi: string;
}

/** Stands in for an expanded row whose children are on their way. */
export function TreeLoadingRow({
  depth,
  height,
  rowIndex,
  tabIndex,
  label,
  dataUi,
}: TreeLoadingRowProps) {
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={false}
      data-ui={dataUi}
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      style={{ height: `${height}px` }}
      className={TREE_ROW_BASE_CLASSES}
    >
      <IndentRails depth={depth} />
      <CaretSlot />
      <Spinner size="sm" className="h-3.5 w-3.5 shrink-0" />
      <span className="text-surface-400">{label}</span>
    </div>
  );
}
