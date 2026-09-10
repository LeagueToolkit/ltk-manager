import { CaretRightIcon } from "@phosphor-icons/react";
import { memo } from "react";

import { twMerge } from "@/utils";

import { ClassCard } from "../bin/ClassCard";
import { ObjectGlyph } from "../components/ObjectGlyph";
import {
  CaretSlot,
  IndentRails,
  TREE_ROW_BASE_CLASSES as ROW_BASE_CLASSES,
  TREE_ROW_STATE_CLASSES as ROW_STATE_CLASSES,
} from "../components/TreeRowParts";
/* The leaves rather than the browsers' barrels, which reach this module back through
   the documents registry mid-evaluation. */
import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { OpenIntent } from "../palette/types";
import { assetContext } from "../preview/assetRef";
import { clickIntent } from "../state";
import { describeFileKind } from "../utils/fileKindIcon";
import type { ReferenceFileNode, ReferenceNode, ReferenceObjectNode } from "./referenceTree";

interface ReferencesTreeRowProps {
  node: ReferenceNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (node: ReferenceFileNode) => void;
  onSelect: (index: number) => void;
  /** A click on an object row, with the intent the click carries. */
  onOpen: (node: ReferenceObjectNode, intent: OpenIntent) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function ReferencesTreeRowInner(props: ReferencesTreeRowProps) {
  const node = props.node;
  if (node.type === "file") return <FileRow {...props} node={node} />;
  return <ObjectRow {...props} node={node} />;
}

export const ReferencesTreeRow = memo(ReferencesTreeRowInner);

function Caret({ isExpanded }: { isExpanded: boolean }) {
  return (
    <CaretRightIcon
      className={twMerge(
        "h-3 w-3 shrink-0 text-surface-400 transition-transform",
        isExpanded && "rotate-90",
      )}
    />
  );
}

interface FileRowProps extends ReferencesTreeRowProps {
  node: ReferenceFileNode;
}

/** One declaring file: its glyph, its path, where it sits, and how many objects it holds. */
function FileRow({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  height,
  rowIndex,
  tabIndex,
}: FileRowProps) {
  const descriptor = describeFileKind(fileKindFromPath(node.file));
  const Icon = descriptor.icon;
  const where = assetContext(node.asset);

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isExpanded}
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="ReferencesTreeRow:file"
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
      <Caret isExpanded={isExpanded} />
      <span className="shrink-0" style={{ color: `var(${descriptor.tintToken})` }}>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="truncate">{node.file}</span>
      {where !== undefined && (
        <span className="shrink-0 text-[0.625rem] text-surface-400">{where}</span>
      )}
      <span className="ml-auto shrink-0 text-[0.625rem] text-surface-500 tabular-nums">
        {node.children.length.toLocaleString()}
      </span>
    </button>
  );
}

interface ObjectRowProps extends ReferencesTreeRowProps {
  node: ReferenceObjectNode;
}

/** One object of a group: its mark, its last segment, the path above it, and its class. */
function ObjectRow({
  node,
  depth,
  isSelected,
  onSelect,
  onOpen,
  height,
  rowIndex,
  tabIndex,
}: ObjectRowProps) {
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-ui="ReferencesTreeRow:object"
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={(event) => {
        onSelect(rowIndex);
        onOpen(node, clickIntent(event));
      }}
      onDoubleClick={() => onOpen(node, "permanent")}
      onContextMenu={() => onSelect(rowIndex)}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("cursor-pointer", ROW_BASE_CLASSES, ROW_STATE_CLASSES)}
      title={node.path}
    >
      <IndentRails depth={depth} />
      <CaretSlot />
      <ObjectGlyph objectClass={node.class} className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      <span className={twMerge("truncate", node.unnamed && "text-surface-300")}>{node.name}</span>
      {node.prefix.length > 0 && (
        <span className="min-w-0 shrink truncate text-[0.625rem] text-surface-400">
          {node.prefix}
        </span>
      )}
      <span className="ml-auto max-w-[40%] shrink-0 truncate">
        <ClassCard classHash={node.classHash} name={node.class} />
      </span>
    </div>
  );
}
