import { ArrowArcLeftIcon, ArrowArcRightIcon, FloppyDiskIcon } from "@phosphor-icons/react";
import { use } from "react";

import { useToast } from "@/components";
import { errorMessage, m, readOnlyDescription } from "@/i18n";
import {
  type CommandMenu,
  type CommandMenuEntry,
  documentHistory,
  documentSave,
  MENU_SEPARATOR,
} from "@/modules/editor";
import { shortcutOf } from "@/modules/keys";

import { ObjectEditItems, ObjectFileItems, ObjectViewItems } from "../components/ObjectBarItems";
import { ObjectMenuContext } from "../state/objectMenu";

/** A command of the tab that any bar lists, with what its item needs. */
export interface ObjectCommands {
  readonly save: (() => void) | null;
  readonly undo: (() => void) | null;
  readonly redo: (() => void) | null;
  /** The reason that the three show while the document takes no edit. */
  readonly reason: string | undefined;
}

/** Returns the save and the history steps of the enclosing object tab, null outside one. */
export function useObjectCommands(): ObjectCommands {
  const menu = use(ObjectMenuContext);
  const toast = useToast();

  if (menu === null || menu.readOnly !== null) {
    return {
      save: null,
      undo: null,
      redo: null,
      reason: menu?.readOnly == null ? undefined : readOnlyDescription(menu.readOnly),
    };
  }

  const { documentId } = menu;

  return {
    save: () => {
      void documentSave(documentId)?.().catch((error: unknown) => {
        toast.error(m.editor_save_failed_hint(), errorMessage(error));
      });
    },
    undo: () => documentHistory(documentId)?.("undo", null),
    redo: () => documentHistory(documentId)?.("redo", null),
    reason: undefined,
  };
}

/** The shared menus of an object tab, which take the items of a view between their own. */
export interface ObjectMenus {
  readonly file: (extra?: readonly CommandMenuEntry[]) => CommandMenu;
  readonly edit: (extra?: readonly CommandMenuEntry[]) => CommandMenu;
  readonly view: (extra?: readonly CommandMenuEntry[]) => CommandMenu;
}

/**
 * Returns the File, Edit and View menus that every class view starts from.
 *
 * Per "Menu bar" in docs/ux/BIN_EDITOR.md. Save, Undo and Redo are data, so the palette lists them.
 * The object's own actions are slots that mount while the menu is open, so a closed bar reads
 * nothing.
 */
export function useObjectMenus(): ObjectMenus {
  const { save, undo, redo, reason } = useObjectCommands();

  return {
    file: (extra = []) => ({
      id: "file",
      title: m.workshop_bin_menu_file_label(),
      className: "w-64",
      items: [
        {
          kind: "command",
          id: "save",
          title: m.workshop_bin_menu_save_action(),
          icon: <FloppyDiskIcon className="size-4" />,
          shortcut: shortcutOf("editor.save"),
          run: save,
          reason,
        },
        MENU_SEPARATOR,
        ...extra,
        MENU_SEPARATOR,
        { kind: "slot", id: "object-file", node: <ObjectFileItems /> },
      ],
    }),
    edit: (extra = []) => ({
      id: "edit",
      title: m.workshop_bin_menu_edit_label(),
      className: "w-64",
      items: [
        {
          kind: "command",
          id: "undo",
          title: m.workshop_bin_menu_undo_action(),
          icon: <ArrowArcLeftIcon className="size-4" />,
          shortcut: shortcutOf("editor.undo"),
          run: undo,
          reason,
        },
        {
          kind: "command",
          id: "redo",
          title: m.workshop_bin_menu_redo_action(),
          icon: <ArrowArcRightIcon className="size-4" />,
          shortcut: shortcutOf("editor.redo"),
          run: redo,
          reason,
        },
        MENU_SEPARATOR,
        ...extra,
        MENU_SEPARATOR,
        { kind: "slot", id: "object-edit", node: <ObjectEditItems /> },
      ],
    }),
    view: (extra = []) => ({
      id: "view",
      title: m.workshop_bin_menu_view_label(),
      className: "w-64",
      items: [
        { kind: "slot", id: "object-mode", node: <ObjectViewItems part="mode" /> },
        MENU_SEPARATOR,
        ...extra,
        MENU_SEPARATOR,
        { kind: "slot", id: "object-view", node: <ObjectViewItems part="panes" /> },
      ],
    }),
  };
}
