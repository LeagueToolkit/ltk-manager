import {
  CaretRightIcon,
  FolderDashedIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import { memo } from "react";
import { twMerge } from "tailwind-merge";

import { Spinner, Tooltip } from "@/components";
import { formatBytes } from "@/utils";

import { describeFileKind } from "../utils/fileKindIcon";
import { fileKindFromPath } from "./fileKind";
import type { SourceDirNode, SourceFileNode, SourceTreeNode } from "./sourceIndex";

/* The same row styling as ContentTreeRow, so the two trees read as one system.
   Selected-hover has to beat plain hover, so it appears later in the string. */
const ROW_BASE_CLASSES =
  "flex items-center gap-1 pr-3 select-none text-surface-200/90 outline-none transition-colors duration-100";
const ROW_STATE_CLASSES =
  "hover:bg-surface-700/70 hover:text-surface-100 " +
  "aria-selected:bg-accent-500/15 aria-selected:text-accent-100 " +
  "aria-selected:hover:bg-accent-500/25 " +
  "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-500/70";

interface SourceTreeRowProps {
  node: SourceTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (node: SourceDirNode) => void;
  onSelect: (index: number) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function SourceTreeRowInner(props: SourceTreeRowProps) {
  const node = props.node;
  if (node.type === "dir") return <DirRow {...props} node={node} />;
  if (node.type === "file") return <FileRow {...props} node={node} />;
  return <LoadingRow {...props} />;
}

export const SourceTreeRow = memo(SourceTreeRowInner);

const RAIL_CLASSES = "w-[10px] shrink-0 self-stretch";

/* One column per ancestor level, each drawing a 1px vertical guide, the same
   scheme as ContentTreeRow. The first column stays blank so a root entry's
   guide never doubles the pane's own edge. */
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

interface DirRowProps extends SourceTreeRowProps {
  node: SourceDirNode;
}

function DirRow({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  height,
  rowIndex,
  tabIndex,
}: DirRowProps) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isExpanded}
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="SourceTreeRow:dir"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={() => {
        onSelect(rowIndex);
        onToggle(node);
      }}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("w-full cursor-pointer text-left", ROW_BASE_CLASSES, ROW_STATE_CLASSES)}
    >
      <IndentRails depth={depth} />
      <CaretRightIcon
        className={twMerge(
          "h-3 w-3 shrink-0 text-surface-400 transition-transform",
          isExpanded && "rotate-90",
        )}
      />
      <DirGlyph unknown={node.unknown} isExpanded={isExpanded} />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-surface-500 tabular-nums">
        {node.fileCount}
      </span>
    </button>
  );
}

function DirGlyph({ unknown, isExpanded }: { unknown: boolean; isExpanded: boolean }) {
  if (unknown) return <FolderDashedIcon className="h-3.5 w-3.5 shrink-0 text-surface-500" />;
  if (isExpanded) return <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-accent-400" />;
  return <FolderIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />;
}

interface FileRowProps extends SourceTreeRowProps {
  node: SourceFileNode;
}

function FileRow({ node, depth, isSelected, onSelect, height, rowIndex, tabIndex }: FileRowProps) {
  const path = node.entry.path;
  const descriptor = describeFileKind(path === null ? "unknown" : fileKindFromPath(path));
  const Icon = descriptor.icon;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="SourceTreeRow:file"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={() => onSelect(rowIndex)}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("cursor-pointer", ROW_BASE_CLASSES, ROW_STATE_CLASSES)}
    >
      <IndentRails depth={depth} />
      {/* Reserve the chevron slot so file and dir names stay column-aligned. */}
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
        {formatBytes(node.entry.sizeBytes)}
      </span>
    </div>
  );
}

function LoadingRow({ depth, height, rowIndex, tabIndex }: SourceTreeRowProps) {
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={false}
      data-ui="SourceTreeRow:loading"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      style={{ height: `${height}px` }}
      className={ROW_BASE_CLASSES}
    >
      <IndentRails depth={depth} />
      <span aria-hidden="true" className="h-3 w-3 shrink-0" />
      <Spinner size="sm" className="h-3.5 w-3.5 shrink-0" />
      <span className="text-surface-400">Loading…</span>
    </div>
  );
}
