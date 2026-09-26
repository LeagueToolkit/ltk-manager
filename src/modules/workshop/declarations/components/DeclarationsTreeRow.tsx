import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowSquareOutIcon,
  CopySimpleIcon,
  CubeIcon,
  FileIcon,
  LinkSimpleIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { memo } from "react";

import { Code, IconButton, SeverityGlyph, Tooltip } from "@/components";
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
import { isSubtreeClick } from "../../shared/utils/treeGestures";
import { clickIntent } from "../../state";
import { type DropTarget, isDraggable, moduleOfRow } from "../utils/outlineDrop";
import { entryTitle, isInGame, type OutlineNode, pathSegments } from "../utils/outlineTree";
import { ModuleBody } from "./ModuleRowBody";
import { Caret, Count, RowTag, useOutlineRow } from "./OutlineRowParts";
import { ValueSummaryView } from "./ValueView";

interface DeclarationsTreeRowProps {
  node: OutlineNode;
  depth: number;
  branch: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  /** Whether a click on a branch opens it rather than folding it. */
  openBranches: boolean;
  /** A caret or branch click. `subtree` asks for every branch below as well. */
  onToggle: (node: OutlineNode, subtree?: boolean) => void;
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
  const { handlers, renamingId, draggedId, isDragClick, drop } = useOutlineRow();
  const opens = !branch || openBranches;
  const drag = useDraggable({
    id: node.id,
    data: { node },
    disabled: handlers === null || !isDraggable(node) || renamingId === node.id,
  });
  const droppable = useDroppable({
    id: node.id,
    data: { node },
    disabled: handlers === null || moduleOfRow(node) === null,
  });

  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        droppable.setNodeRef(element);
      }}
      {...drag.listeners}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-expanded={branch ? isExpanded : undefined}
      data-ui={`DeclarationsTreeRow:${node.type}`}
      data-treeitem-index={rowIndex}
      tabIndex={tabIndex}
      onClick={(event) => {
        if (isDragClick()) return;

        onSelect(rowIndex);
        if (opens && node.type !== "key") onOpen(node, clickIntent(event));
        else if (branch) onToggle(node, isSubtreeClick(event));
      }}
      onDoubleClick={() => {
        if (node.type === "key") onOpen(node, "permanent");
        if (node.type === "module" && !openBranches) handlers?.onRename(node);
      }}
      onFocus={() => onSelect(rowIndex)}
      style={{ height: `${height}px` }}
      className={twMerge(
        "group/row relative cursor-pointer",
        TREE_ROW_BASE_CLASSES,
        TREE_ROW_STATE_CLASSES,
        draggedId === node.id && "opacity-40",
        node.type === "module" && dropMarkClasses(drop, node.id),
      )}
    >
      <IndentRails depth={depth} />
      {branch && (
        <Caret isExpanded={isExpanded} onClick={(event) => onToggle(node, isSubtreeClick(event))} />
      )}
      {!branch && <CaretSlot />}
      <RowBody node={node} onOpen={onOpen} />
    </div>
  );
}

export const DeclarationsTreeRow = memo(DeclarationsTreeRowInner);

function RowBody({
  node,
  onOpen,
}: {
  node: OutlineNode;
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
}) {
  switch (node.type) {
    case "layer":
      return <LayerBody node={node} />;
    case "module":
      return <ModuleBody node={node} />;
    case "entry":
      return <EntryBody entry={node.entry} onGoTo={(intent) => onOpen(node, intent)} />;
    case "key":
      return (
        <KeyBody
          declared={node.key}
          inGame={isInGame(node.entry)}
          onGoTo={(intent) => onOpen(node, intent)}
        />
      );
    case "link":
      return <LinkBody node={node} />;
    case "override":
      return <OverrideBody node={node} />;
    case "empty":
      return <EmptyBody />;
    case "add":
      return <AddBody />;
  }
}

const DROP_CLASSES = {
  into: "bg-accent-500/15 ring-1 ring-inset ring-accent-500/60",
  above: "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent-500",
  below: "before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent-500",
} as const;

/** The classes that mark a module row as where the dragged row lands. */
function dropMarkClasses(drop: DropTarget | null, id: string) {
  return drop?.moduleId === id ? DROP_CLASSES[drop.placement] : false;
}

function EmptyBody() {
  return (
    <span className="min-w-0 truncate font-sans text-[0.625rem] text-surface-500 italic">
      {m.workshop_declarations_empty_module_hint()}
    </span>
  );
}

function AddBody() {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-sans text-surface-400 group-hover/row:text-surface-200">
      <PlusIcon weight="bold" className="h-3 w-3 shrink-0" />
      {m.workshop_declarations_new_module_action()}
    </span>
  );
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

function EntryBody({
  entry,
  onGoTo,
}: {
  entry: DeclaredEntry;
  onGoTo: (intent: OpenIntent) => void;
}) {
  const { shape } = useOutlineRow();
  const removed = entry.object?.kind === "remove";

  return (
    <>
      <EntryGlyph entry={entry} />
      <span
        className={twMerge(
          "min-w-0 shrink-0 truncate",
          removed && "text-surface-400 line-through decoration-danger-text/60",
        )}
        title={entry.name}
      >
        {entryTitle(entry)}
      </span>
      {entry.knownName !== null && <Code className="shrink-0 select-text">{entry.name}</Code>}
      {entry.object !== null && <ObjectEditTag entry={entry} />}
      <Count value={entry.keys.length} />
      {shape.keys && isInGame(entry) && <GoToAction onGoTo={onGoTo} />}
    </>
  );
}

/** What the entry is to the chunk: an object the game holds, or one the module creates or removes. */
function EntryGlyph({ entry }: { entry: DeclaredEntry }) {
  const object = entry.object;
  if (object === null) return <CubeIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />;

  /* A sign's tone, the same the keys take: SIGN_CLASSES. */
  if (object.kind === "remove") {
    return <MinusCircleIcon weight="bold" className="h-3.5 w-3.5 shrink-0 text-danger-text" />;
  }
  if (object.kind === "clone") {
    return <CopySimpleIcon weight="bold" className="h-3.5 w-3.5 shrink-0 text-success-text" />;
  }
  return <PlusCircleIcon weight="bold" className="h-3.5 w-3.5 shrink-0 text-success-text" />;
}

function ObjectEditTag({ entry }: { entry: DeclaredEntry }) {
  const object = entry.object;
  if (object === null) return null;

  if (object.kind === "remove") {
    return <RowTag className="text-danger-text">{m.workshop_declarations_remove_label()}</RowTag>;
  }

  if (object.kind === "clone") {
    return (
      <RowTag>
        {m.workshop_declarations_clone_tag()}
        <span className="truncate font-mono text-surface-300" title={object.source}>
          {object.knownSource ?? object.source}
        </span>
      </RowTag>
    );
  }

  return (
    <RowTag>
      {m.workshop_declarations_construct_tag()}
      {/* DS-KIND-HUE */}
      <span className="truncate font-mono text-bin-class-text" title={object.class}>
        {object.knownClass ?? object.class}
      </span>
    </RowTag>
  );
}

/* A sign reads as the key's first character, so it takes the tone a diff gives it. */
const SIGN_CLASSES: Record<DeclaredSign, string> = {
  set: "text-surface-500",
  add: "text-success-text",
  remove: "text-danger-text",
};

const SIGN_TEXT: Record<DeclaredSign, string> = { set: "", add: "+", remove: "-" };

/** A key as the manifest spells it: the path in the outline's path column, then the value. */
function KeyBody({
  declared,
  inGame,
  onGoTo,
}: {
  declared: DeclaredKey;
  /** The key's entry is in a game bin, which Go to row opens on. */
  inGame: boolean;
  onGoTo: (intent: OpenIntent) => void;
}) {
  const segments = pathSegments(declared.path);
  const leaf = segments.pop() ?? "";

  return (
    <>
      <span
        className="flex min-w-0 shrink-0 items-baseline"
        style={{ width: "calc(var(--path-cols) * 1ch)" }}
        title={declared.key}
      >
        <Sign sign={declared.sign} />
        {segments.length > 0 && (
          <span className="min-w-0 truncate text-surface-400">{`${segments.join(".")}.`}</span>
        )}
        <span className="shrink-0 text-surface-100">{leaf}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center pl-3">
        <ValueSummaryView value={declared.value} />
      </span>
      {inGame && <GoToAction onGoTo={onGoTo} />}
    </>
  );
}

function Sign({ sign }: { sign: DeclaredSign }) {
  return (
    <span className={twMerge("w-[1ch] shrink-0 font-medium", SIGN_CLASSES[sign])}>
      {SIGN_TEXT[sign]}
    </span>
  );
}

function LinkBody({ node }: { node: Extract<OutlineNode, { type: "link" }> }) {
  return (
    <>
      <Sign sign={node.sign} />
      <LinkSimpleIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      <span className="min-w-0 truncate text-surface-200" title={node.path}>
        {node.path}
      </span>
      <RowTag className="ml-auto pl-2">{m.workshop_declarations_link_tag()}</RowTag>
    </>
  );
}

function OverrideBody({ node }: { node: Extract<OutlineNode, { type: "override" }> }) {
  return (
    <>
      <span className="w-[1ch] shrink-0" />
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
      <span className="min-w-0 truncate text-surface-200" title={node.path}>
        {node.path}
      </span>
      <RowTag className="ml-auto pl-2">{m.workshop_declarations_override_tag()}</RowTag>
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
