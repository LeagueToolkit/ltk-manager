import { ChevronRight, Folder as FolderIconDefault, FolderOpen } from "lucide-react";
import { memo } from "react";
import { twMerge } from "tailwind-merge";

import { Tooltip } from "@/components";
import { formatBytes } from "@/utils";

import type { ContentTreeNode, DirNode, FileNode } from "../utils/contentTree";
import { describeFileKind } from "../utils/fileKindIcon";

/** Shared row styling. Kept as string constants so the hover/selected variants
 * cascade cleanly in Tailwind 4 — selected-hover has to beat plain hover, so
 * it appears later in the class string. */
/* The tree is set in JetBrains Mono, which carries more ink per row than the sans
   the rest of the app uses, so the same rung reads brighter here. The name settles
   a little under it and the hover still climbs to a full rung. */
const ROW_BASE_CLASSES =
  "flex items-center gap-1 pr-3 select-none text-surface-200/90 outline-none transition-colors duration-100";
const ROW_STATE_CLASSES =
  "hover:bg-surface-700/70 hover:text-surface-100 " +
  "aria-selected:bg-accent-500/15 aria-selected:text-accent-100 " +
  "aria-selected:hover:bg-accent-500/25 " +
  "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-500/70";

interface TreeRowProps {
  node: ContentTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  dirFileCount: number;
  onToggle: (path: string) => void;
  onSelect: (index: number) => void;
  /** A double click on a file row, or its Open menu item. */
  onOpen?: (node: FileNode) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function TreeRowInner({
  node,
  depth,
  isExpanded,
  isSelected,
  dirFileCount,
  onToggle,
  onSelect,
  onOpen,
  height,
  rowIndex,
  tabIndex,
}: TreeRowProps) {
  if (node.type === "dir") {
    return (
      <DirRow
        node={node}
        depth={depth}
        isExpanded={isExpanded}
        isSelected={isSelected}
        fileCount={dirFileCount}
        onToggle={onToggle}
        onSelect={onSelect}
        height={height}
        rowIndex={rowIndex}
        tabIndex={tabIndex}
      />
    );
  }
  return (
    <FileRow
      node={node}
      depth={depth}
      isSelected={isSelected}
      onSelect={onSelect}
      onOpen={onOpen}
      height={height}
      rowIndex={rowIndex}
      tabIndex={tabIndex}
    />
  );
}

const RAIL_CLASSES = "w-[10px] shrink-0 self-stretch";

/** One column per ancestor level, each drawing a 1px vertical guide on its left
 * edge. Since every row in the virtual window draws its own rails at the same
 * left offsets, the lines appear continuous.
 *
 * The first column stays blank. A root entry's guide would sit against the
 * pane's own edge and read as a second border running down it. */
function IndentRails({ depth }: { depth: number }) {
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

export const TreeRow = memo(TreeRowInner);

interface DirRowProps {
  node: DirNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  fileCount: number;
  onToggle: (path: string) => void;
  onSelect: (index: number) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function DirRow({
  node,
  depth,
  isExpanded,
  isSelected,
  fileCount,
  onToggle,
  onSelect,
  height,
  rowIndex,
  tabIndex,
}: DirRowProps) {
  const FolderIcon = isExpanded ? FolderOpen : FolderIconDefault;

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isExpanded}
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="ContentTreeRow:dir"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={() => {
        onSelect(rowIndex);
        onToggle(node.path);
      }}
      onContextMenu={() => onSelect(rowIndex)}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("w-full cursor-pointer text-left", ROW_BASE_CLASSES, ROW_STATE_CLASSES)}
    >
      <IndentRails depth={depth} />
      <ChevronRight
        className={twMerge(
          "h-3 w-3 shrink-0 text-surface-400 transition-transform",
          isExpanded && "rotate-90",
        )}
      />
      <FolderIcon
        className={twMerge(
          "h-3.5 w-3.5 shrink-0",
          isExpanded ? "text-accent-400" : "text-surface-400",
        )}
        strokeWidth={1.75}
      />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-surface-500 tabular-nums">
        {fileCount}
      </span>
    </button>
  );
}

interface FileRowProps {
  node: FileNode;
  depth: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
  onOpen?: (node: FileNode) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function FileRow({
  node,
  depth,
  isSelected,
  onSelect,
  onOpen,
  height,
  rowIndex,
  tabIndex,
}: FileRowProps) {
  const descriptor = describeFileKind(node.entry.kind);
  const Icon = descriptor.icon;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="ContentTreeRow:file"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={() => onSelect(rowIndex)}
      onDoubleClick={() => onOpen?.(node)}
      onContextMenu={() => onSelect(rowIndex)}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("cursor-pointer", ROW_BASE_CLASSES, ROW_STATE_CLASSES)}
    >
      <IndentRails depth={depth} />
      {/* Reserve chevron slot on files so file and dir names stay column-aligned. */}
      <span aria-hidden="true" className="h-3 w-3 shrink-0" />
      <Tooltip content={descriptor.label}>
        <span
          className="shrink-0"
          style={{ color: `var(${descriptor.tintToken})` }}
          aria-label={descriptor.label}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
      </Tooltip>
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-surface-400 tabular-nums">
        {formatBytes(Number(node.entry.sizeBytes))}
      </span>
    </div>
  );
}
