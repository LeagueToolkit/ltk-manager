import { ArrowDownIcon, ArrowUpIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { DeclaredModule } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { moduleTally, moduleTitle, type OutlineNode } from "../utils/outlineTree";
import { ModuleNameInput, RowKebab, useOutlineRow } from "./OutlineRowParts";

/** A module: its name, what it edits and the comment above it, then what it declares there. */
export function ModuleBody({ node }: { node: Extract<OutlineNode, { type: "module" }> }) {
  const { handlers, renamingId, endRename } = useOutlineRow();
  const { layer, module } = node;
  const writesHere = handlers?.actions.writesHere(layer, module) ?? false;

  if (renamingId === node.id && handlers !== null) {
    return (
      <ModuleNameInput
        initial={module.name ?? ""}
        onCommit={(name) => {
          endRename();
          handlers.actions.rename(layer, module, name);
        }}
        onCancel={endRename}
        className="h-5 min-w-0 flex-1 font-sans"
      />
    );
  }

  return (
    <>
      <span
        className={twMerge(
          "shrink-0 font-sans font-medium text-surface-100",
          module.name === null && "text-surface-300 italic",
        )}
      >
        {moduleTitle(module)}
      </span>
      {writesHere && (
        <Tooltip content={m.workshop_declarations_writes_here_hint()}>
          <PencilSimpleLineIcon
            weight="bold"
            aria-label={m.workshop_declarations_writes_here_label()}
            className="h-3 w-3 shrink-0 text-accent-400"
          />
        </Tooltip>
      )}
      <ModuleDetail module={module} />
      <span className="ml-auto shrink-0 pl-2 font-sans text-[0.625rem] text-surface-500 tabular-nums">
        {tallyText(module)}
      </span>
      {handlers !== null && <MoveButtons node={node} />}
      <RowKebab node={node} />
    </>
  );
}

/** The module's place in the apply order, one step up or down. */
function MoveButtons({ node }: { node: Extract<OutlineNode, { type: "module" }> }) {
  const { handlers } = useOutlineRow();
  if (handlers === null) return null;

  const { layer, module } = node;
  const last = handlers.modulesOf(layer).length - 1;

  return (
    <>
      <RowButton
        label={m.workshop_declarations_move_up_action()}
        icon={<ArrowUpIcon weight="bold" className="h-3 w-3" />}
        disabled={module.index === 0}
        onPress={() => void handlers.actions.move(layer, module, module.index - 1)}
      />
      <RowButton
        label={m.workshop_declarations_move_down_action()}
        icon={<ArrowDownIcon weight="bold" className="h-3 w-3" />}
        disabled={module.index >= last}
        onPress={() => void handlers.actions.move(layer, module, module.index + 1)}
      />
    </>
  );
}

interface RowButtonProps {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onPress: () => void;
}

/** A hover action of a row, out of the tab order the row's own keys cover. */
function RowButton({ label, icon, disabled, onPress }: RowButtonProps) {
  return (
    <Tooltip content={label}>
      <IconButton
        icon={icon}
        variant="ghost"
        size="xs"
        compact
        tabIndex={-1}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onPress();
        }}
        className="h-5 w-5 shrink-0 opacity-0 group-hover/row:opacity-100 group-aria-selected/row:opacity-100"
      />
    </Tooltip>
  );
}

/** What a module edits, and its note: the chunk's file name, or its entries in every bin. */
function ModuleDetail({ module }: { module: DeclaredModule }) {
  const file = module.target?.slice(module.target.lastIndexOf("/") + 1);

  return (
    <span className="flex min-w-0 shrink items-center gap-2 text-[0.625rem] text-surface-400">
      <span className="shrink-0" title={module.target ?? undefined}>
        {file ?? m.workshop_declarations_entries_label()}
      </span>
      {module.source !== null && (
        <span className="shrink-0">
          {m.workshop_declarations_source_label({ file: module.source })}
        </span>
      )}
      {module.note !== null && (
        <span className="min-w-0 truncate font-sans text-surface-500 italic" title={module.note}>
          {module.note.split("\n")[0]}
        </span>
      )}
    </span>
  );
}

function tallyText(module: DeclaredModule): string {
  const tally = moduleTally(module);
  const objects = tally.edited + tally.created + tally.removed;
  const parts = [
    objects > 0 && m.workshop_declarations_objects_label({ count: objects }),
    tally.keys > 0 && m.workshop_declarations_keys_label({ count: tally.keys }),
    tally.links > 0 && m.workshop_declarations_links_label({ count: tally.links }),
    tally.overrides > 0 && m.workshop_declarations_overrides_label({ count: tally.overrides }),
  ];

  return parts.filter((part) => part !== false).join(" · ");
}
