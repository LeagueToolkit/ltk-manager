import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CrosshairIcon,
  CubeIcon,
  ListBulletsIcon,
} from "@phosphor-icons/react";
import { memo, type ReactNode } from "react";

import { IconButton, SeverityGlyph, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { DeclaredEntry, DeclaredKey, DeclaredSign } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { layerTitle } from "../../documents/utils/contentDocument";
import { LayerGlyph } from "../../layers/components/LayerGlyph";
import type { OpenIntent } from "../../palette/utils/types";
import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  CaretSlot,
  IndentRails,
  TREE_ROW_BASE_CLASSES,
  TREE_ROW_STATE_CLASSES,
} from "../../shared/components/TreeRowParts";
import { clickIntent } from "../../state";
import { moduleKeyCount, moduleTitle, type OutlineNode, valuePreview } from "../utils/outlineTree";

interface DeclarationsTreeRowProps {
  node: OutlineNode;
  depth: number;
  branch: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  /** Whether a click on a branch opens it rather than folding it. */
  openBranches: boolean;
  onToggle: (node: OutlineNode) => void;
  onSelect: (index: number) => void;
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
  height: number;
  rowIndex: number;
  tabIndex: number;
}

function DeclarationsTreeRowInner({
  node,
  depth,
  branch,
  isExpanded,
  isSelected,
  openBranches,
  onToggle,
  onSelect,
  onOpen,
  height,
  rowIndex,
  tabIndex,
}: DeclarationsTreeRowProps) {
  const opens = !branch || openBranches;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-expanded={branch ? isExpanded : undefined}
      data-ui={`DeclarationsTreeRow:${node.type}`}
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={(event) => {
        onSelect(rowIndex);
        if (opens && node.type !== "key") onOpen(node, clickIntent(event));
        else if (branch) onToggle(node);
      }}
      onDoubleClick={() => {
        if (node.type === "key") onOpen(node, "permanent");
      }}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge("group/row cursor-pointer", TREE_ROW_BASE_CLASSES, TREE_ROW_STATE_CLASSES)}
    >
      <IndentRails depth={depth} />
      {branch && (
        <Caret
          isExpanded={isExpanded}
          onClick={() => {
            onSelect(rowIndex);
            onToggle(node);
          }}
        />
      )}
      {!branch && <CaretSlot />}
      <RowBody node={node} onOpen={onOpen} />
    </div>
  );
}

export const DeclarationsTreeRow = memo(DeclarationsTreeRowInner);

function Caret({ isExpanded, onClick }: { isExpanded: boolean; onClick: () => void }) {
  return (
    <span
      aria-hidden
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-3 w-3 shrink-0 items-center justify-center"
    >
      <CaretRightIcon
        className={twMerge(
          "h-3 w-3 text-surface-400 transition-transform",
          isExpanded && "rotate-90",
        )}
      />
    </span>
  );
}

function RowBody({
  node,
  onOpen,
}: {
  node: OutlineNode;
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
}) {
  if (node.type === "layer") return <LayerBody node={node} />;
  if (node.type === "module") return <ModuleBody node={node} />;
  if (node.type === "entry") return <EntryBody entry={node.entry} />;
  return <KeyBody declared={node.key} onGoTo={(intent) => onOpen(node, intent)} />;
}

function LayerBody({ node }: { node: Extract<OutlineNode, { type: "layer" }> }) {
  const project = useProjectContext();
  const { layer } = node;

  return (
    <>
      <LayerGlyph layerName={layer.layer} />
      <span className="truncate font-sans font-medium">{layerTitle(project, layer.layer)}</span>
      <span className="min-w-0 shrink truncate text-[0.625rem] text-surface-400">{layer.file}</span>
      {layer.error !== null && (
        <Tooltip content={layer.error.message}>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.625rem] text-danger-text">
            <SeverityGlyph severity="error" />
            {m.workshop_declarations_load_error_label()}
          </span>
        </Tooltip>
      )}
      {layer.error === null && <Count value={layer.modules.length} />}
    </>
  );
}

function ModuleBody({ node }: { node: Extract<OutlineNode, { type: "module" }> }) {
  const { module } = node;
  const detail = module.target ?? m.workshop_declarations_entries_label();

  return (
    <>
      {module.selector === "target" && (
        <CrosshairIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      )}
      {module.selector === "entries" && (
        <ListBulletsIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      )}
      <span className="shrink-0 font-sans font-medium">{moduleTitle(module)}</span>
      <span className="min-w-0 shrink truncate text-[0.625rem] text-surface-400" title={detail}>
        {detail}
      </span>
      {module.source !== null && (
        <span className="min-w-0 shrink truncate text-[0.625rem] text-surface-500">
          {m.workshop_declarations_source_label({ file: module.source })}
        </span>
      )}
      <Count value={moduleKeyCount(module)} />
    </>
  );
}

function EntryBody({ entry }: { entry: DeclaredEntry }) {
  return (
    <>
      <CubeIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      <span className="truncate" title={entry.name}>
        {entry.name}
      </span>
      {entry.object !== null && <ObjectEditTag entry={entry} />}
      <Count value={entry.keys.length} />
    </>
  );
}

function ObjectEditTag({ entry }: { entry: DeclaredEntry }) {
  const object = entry.object;
  if (object === null) return null;

  let label: string;
  if (object.kind === "clone")
    label = m.workshop_declarations_clone_label({ source: object.source });
  else if (object.kind === "construct") {
    label = m.workshop_declarations_construct_label({ class: object.class });
  } else label = m.workshop_declarations_remove_label();

  return (
    <span className="min-w-0 shrink truncate font-sans text-[0.625rem] text-surface-400">
      {label}
    </span>
  );
}

/* A sign reads as the key's first character, so it takes the tone a diff gives it. */
const SIGN_CLASSES: Record<DeclaredSign, string> = {
  set: "text-surface-500",
  add: "text-success-text",
  remove: "text-danger-text",
};

const SIGN_TEXT: Record<DeclaredSign, string> = { set: "", add: "+", remove: "-" };

function KeyBody({
  declared,
  onGoTo,
}: {
  declared: DeclaredKey;
  onGoTo: (intent: OpenIntent) => void;
}) {
  return (
    <>
      <span className="min-w-0 shrink-0 truncate" title={declared.key}>
        <span className={SIGN_CLASSES[declared.sign]}>{SIGN_TEXT[declared.sign]}</span>
        {declared.path}
      </span>
      <span className="min-w-0 flex-1 truncate text-surface-400" title={declared.value}>
        {valuePreview(declared.value)}
      </span>
      <GoToAction onGoTo={onGoTo} />
    </>
  );
}

function GoToAction({ onGoTo }: { onGoTo: (intent: OpenIntent) => void }) {
  return (
    <Tooltip content={m.workshop_declarations_go_to_action()} side="left">
      <IconButton
        icon={<ArrowSquareOutIcon weight="bold" className="h-3.5 w-3.5" />}
        variant="ghost"
        size="xs"
        compact
        tabIndex={-1}
        aria-label={m.workshop_declarations_go_to_action()}
        onClick={(event) => {
          event.stopPropagation();
          onGoTo(clickIntent(event));
        }}
        className="h-5 w-5 shrink-0 opacity-0 group-hover/row:opacity-100 group-aria-selected/row:opacity-100"
      />
    </Tooltip>
  );
}

function Count({ value }: { value: number }): ReactNode {
  return (
    <span className="ml-auto shrink-0 pl-2 text-[0.625rem] text-surface-500 tabular-nums">
      {value.toLocaleString()}
    </span>
  );
}
