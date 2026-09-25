import {
  ArrowDownIcon,
  ArrowSquareOutIcon,
  ArrowsLeftRightIcon,
  ArrowUpIcon,
  ClipboardTextIcon,
  PencilSimpleIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  TextAlignLeftIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import { Menu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { DeclaredEntry, DeclaredModule } from "@/lib/tauri";

import type { OpenIntent } from "../../palette/utils/types";
import type { OutlineActions } from "../hooks/useOutlineActions";
import { isInGame, moduleTitle, type OutlineNode } from "../utils/outlineTree";

/** What an outline's menu reaches beyond the module actions. */
export interface OutlineMenuHandlers {
  actions: OutlineActions;
  /** The modules of every layer the outline draws, by layer. */
  modulesOf: (layer: string) => readonly DeclaredModule[];
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
  onRename: (node: OutlineNode) => void;
  /** Add a module at the end of `layer` and type its name in place. */
  onCreate: (layer: string) => void;
  /** Move the keys into a module made for them, and type its name in place. */
  onMoveToNew: (
    layer: string,
    module: DeclaredModule,
    entry: DeclaredEntry,
    path: string | null,
  ) => void;
  /** Select the node's lines in the manifest's text. Absent where no text is on screen. */
  onShowInText?: (node: OutlineNode) => void;
}

/**
 * Everything a row of the declarations outline offers, for its context menu and its kebab.
 *
 * Per "Game data" in docs/ux/PROJECT_EDITOR.md. DS-MENU-SCOPE: one list per row, whichever
 * part of the row was hit.
 */
export function OutlineMenuItems({
  node,
  handlers,
}: {
  node: OutlineNode;
  handlers: OutlineMenuHandlers;
}) {
  switch (node.type) {
    case "layer":
      return (
        <>
          <Menu.Item icon={<ArrowSquareOutIcon />} onClick={() => handlers.onOpen(node, "default")}>
            {m.workshop_declarations_open_action()}
          </Menu.Item>
          {node.layer.error === null && (
            <NewModuleItem layer={node.layer.layer} handlers={handlers} />
          )}
        </>
      );
    case "add":
    case "empty":
      return <NewModuleItem layer={node.layer} handlers={handlers} />;
    case "module":
      return <ModuleItems node={node} handlers={handlers} />;
    case "entry":
      return (
        <>
          <GoToItem node={node} handlers={handlers} disabled={!isInGame(node.entry)} />
          <MoveToModule
            layer={node.layer}
            module={node.module}
            entry={node.entry}
            path={null}
            handlers={handlers}
          />
          <ShowInTextItem node={node} handlers={handlers} />
        </>
      );
    case "key":
      return (
        <>
          <GoToItem node={node} handlers={handlers} disabled={!isInGame(node.entry)} />
          <MoveToModule
            layer={node.layer}
            module={node.module}
            entry={node.entry}
            path={node.key.path}
            handlers={handlers}
          />
          <CopyItem text={node.key.value} label={m.workshop_declarations_value_label()} />
          <ShowInTextItem node={node} handlers={handlers} />
        </>
      );
    case "link":
    case "override":
      return (
        <>
          <CopyItem text={node.path} label={m.workshop_bin_path_label()} />
          <ShowInTextItem node={node} handlers={handlers} />
        </>
      );
  }
}

type ModuleNode = Extract<OutlineNode, { type: "module" }>;

function ModuleItems({ node, handlers }: { node: ModuleNode; handlers: OutlineMenuHandlers }) {
  const { actions } = handlers;
  const { layer, module } = node;
  const last = handlers.modulesOf(layer).length - 1;
  const takesKeys = module.selector === "entries";
  const writesHere = actions.writesHere(layer, module);

  return (
    <>
      <Menu.Item icon={<PencilSimpleIcon />} shortcut="F2" onClick={() => handlers.onRename(node)}>
        {m.workshop_declarations_rename_action()}
      </Menu.Item>
      <Menu.Item
        icon={<PencilSimpleLineIcon />}
        disabled={!takesKeys}
        title={takesKeys ? undefined : m.workshop_bin_module_target_hint()}
        onClick={() => actions.toggleWriteHere(layer, module)}
      >
        {writesHere
          ? m.workshop_declarations_stop_writing_here_action()
          : m.workshop_declarations_write_here_action()}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item
        icon={<ArrowUpIcon />}
        shortcut="Alt+↑"
        disabled={module.index === 0}
        onClick={() => actions.move(layer, module, module.index - 1)}
      >
        {m.workshop_declarations_move_up_action()}
      </Menu.Item>
      <Menu.Item
        icon={<ArrowDownIcon />}
        shortcut="Alt+↓"
        disabled={module.index >= last}
        onClick={() => actions.move(layer, module, module.index + 1)}
      >
        {m.workshop_declarations_move_down_action()}
      </Menu.Item>
      <ShowInTextItem node={node} handlers={handlers} />
      <NewModuleItem layer={layer} handlers={handlers} />
      <Menu.Separator />
      <Menu.Item
        icon={<TrashIcon />}
        variant="danger"
        shortcut="Del"
        onClick={() => actions.remove(layer, module)}
      >
        {m.workshop_declarations_remove_module_action()}
      </Menu.Item>
    </>
  );
}

function NewModuleItem({ layer, handlers }: { layer: string; handlers: OutlineMenuHandlers }) {
  return (
    <Menu.Item icon={<PlusIcon />} onClick={() => handlers.onCreate(layer)}>
      {m.workshop_declarations_new_module_action()}
    </Menu.Item>
  );
}

function GoToItem({
  node,
  handlers,
  disabled,
}: {
  node: OutlineNode;
  handlers: OutlineMenuHandlers;
  disabled: boolean;
}) {
  return (
    <Menu.Item
      icon={<ArrowSquareOutIcon />}
      shortcut="Enter"
      disabled={disabled}
      title={disabled ? m.workshop_declarations_go_to_created_hint() : undefined}
      onClick={() => handlers.onOpen(node, "default")}
    >
      {m.workshop_declarations_go_to_action()}
    </Menu.Item>
  );
}

function ShowInTextItem({ node, handlers }: { node: OutlineNode; handlers: OutlineMenuHandlers }) {
  const show = handlers.onShowInText;
  if (show === undefined) return null;

  return (
    <Menu.Item icon={<TextAlignLeftIcon />} onClick={() => show(node)}>
      {m.workshop_declarations_show_in_text_action()}
    </Menu.Item>
  );
}

function CopyItem({ text, label }: { text: string; label: string }) {
  const copy = useCopyToClipboard();

  return (
    <Menu.Item icon={<ClipboardTextIcon />} onClick={() => void copy(text, label)}>
      {m.workshop_declarations_copy_action({ what: label })}
    </Menu.Item>
  );
}

interface MoveToModuleProps {
  layer: string;
  module: DeclaredModule;
  entry: DeclaredEntry;
  /** The property path whose keys move, or null for the entry's whole body. */
  path: string | null;
  handlers: OutlineMenuHandlers;
}

/**
 * Carry the keys to another `entries` module of the layer, or to a module made for them. Only
 * an `entries` module moves them.
 */
function MoveToModule({ layer, module, entry, path, handlers }: MoveToModuleProps) {
  if (module.selector !== "entries") return null;
  const targets = handlers
    .modulesOf(layer)
    .filter((other) => other.selector === "entries" && other.index !== module.index);

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger icon={<ArrowsLeftRightIcon />}>
        {m.workshop_bin_move_to_module_action()}
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.SubmenuPositioner>
          <Menu.Popup data-ui="OutlineMenuItems:move-to-module">
            {targets.map((target) => (
              <Menu.Item
                key={target.index}
                onClick={() =>
                  void handlers.actions.moveKeys(layer, module, entry, path, target.index)
                }
              >
                {moduleTitle(target)}
              </Menu.Item>
            ))}
            {targets.length > 0 && <Menu.Separator />}
            <Menu.Item
              icon={<PlusIcon />}
              onClick={() => handlers.onMoveToNew(layer, module, entry, path)}
            >
              {m.workshop_declarations_new_module_ellipsis_action()}
            </Menu.Item>
          </Menu.Popup>
        </Menu.SubmenuPositioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
