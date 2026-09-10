import { CaretRightIcon } from "@phosphor-icons/react";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import { MarkedText, Tooltip } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";
import { formatBytes } from "@/utils";

import {
  CaretSlot,
  FolderGlyph,
  IndentRails,
  TREE_ROW_BASE_CLASSES as ROW_BASE_CLASSES,
  TREE_ROW_STATE_CLASSES as ROW_STATE_CLASSES,
  TreeLoadingRow,
} from "../components/TreeRowParts";
import { describeFileKind } from "../utils/fileKindIcon";
import { fileKindFromPath } from "./fileKind";
import type { SourceDirNode, SourceFileNode, SourceTreeNode } from "./sourceIndex";

interface SourceTreeRowProps {
  node: SourceTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  /** A selected directory holds this row, so it draws the fill at half strength. */
  covered?: boolean;
  onToggle: (node: SourceDirNode) => void;
  /** A click, which writes the selection under whichever modifiers it carried. */
  onSelect: (index: number, event?: ReactMouseEvent<HTMLElement>) => void;
  /** The focus landing here, which moves the ring and nothing else. */
  onFocusRow: (index: number) => void;
  /** A double click on a file row, or its Open menu item. */
  onOpen?: (node: SourceFileNode) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

/* Half the selected fill, so the reach of a selected directory is visible
   without a count. `aria-selected` wins over it by its own specificity. */
const COVERED_CLASS = "bg-accent-500/8";

function SourceTreeRowInner(props: SourceTreeRowProps) {
  const node = props.node;
  if (node.type === "dir") return <DirRow {...props} node={node} />;
  if (node.type === "file") return <FileRow {...props} node={node} />;
  return <LoadingRow {...props} />;
}

export const SourceTreeRow = memo(SourceTreeRowInner);

interface DirRowProps extends SourceTreeRowProps {
  node: SourceDirNode;
}

function DirRow({
  node,
  depth,
  isExpanded,
  isSelected,
  covered,
  onToggle,
  onSelect,
  onFocusRow,
  height,
  rowIndex,
  tabIndex,
}: DirRowProps) {
  return (
    <div
      role="treeitem"
      aria-expanded={isExpanded}
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="SourceTreeRow:dir"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={(event) => onSelect(rowIndex, event)}
      onDoubleClick={() => onToggle(node)}
      onFocus={() => onFocusRow(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge(
        "w-full cursor-pointer text-left",
        ROW_BASE_CLASSES,
        covered && COVERED_CLASS,
        ROW_STATE_CLASSES,
      )}
    >
      <IndentRails depth={depth} />
      {/* Its own target, so opening a directory is not also selecting every
          file below it, which is what selecting a directory means. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={
          isExpanded ? m.workshop_explorer_collapse_action() : m.workshop_explorer_expand_action()
        }
        onClick={(event) => {
          event.stopPropagation();
          onToggle(node);
        }}
        className="-m-0.5 shrink-0 rounded-sm p-0.5 hover:bg-surface-veil"
      >
        <CaretRightIcon
          className={twMerge(
            "h-3 w-3 text-surface-400 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      <FolderGlyph unknown={node.unknown} isExpanded={isExpanded} />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-fine text-surface-500 tabular-nums">
        {node.fileCount}
      </span>
    </div>
  );
}

interface FileRowProps extends SourceTreeRowProps {
  node: SourceFileNode;
}

function FileRow({
  node,
  depth,
  isSelected,
  covered,
  onSelect,
  onFocusRow,
  onOpen,
  height,
  rowIndex,
  tabIndex,
}: FileRowProps) {
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
      onClick={(event) => onSelect(rowIndex, event)}
      onDoubleClick={() => onOpen?.(node)}
      onFocus={() => onFocusRow(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge(
        "cursor-pointer",
        ROW_BASE_CLASSES,
        covered && COVERED_CLASS,
        ROW_STATE_CLASSES,
      )}
    >
      <IndentRails depth={depth} />
      <CaretSlot />
      <Tooltip content={descriptor.label}>
        <span
          className="shrink-0"
          style={{ color: `var(${descriptor.tintToken})` }}
          aria-label={descriptor.label}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
      </Tooltip>
      <span className="truncate">
        <MarkedText text={node.name} ranges={node.entry.nameRanges} />
      </span>
      <span className="ml-auto shrink-0 font-mono text-fine text-surface-400 tabular-nums">
        {formatBytes(node.entry.sizeBytes)}
      </span>
    </div>
  );
}

function LoadingRow({ depth, height, rowIndex, tabIndex }: SourceTreeRowProps) {
  return (
    <TreeLoadingRow
      depth={depth}
      height={height}
      rowIndex={rowIndex}
      tabIndex={tabIndex}
      label="Loading…"
      dataUi="SourceTreeRow:loading"
    />
  );
}
