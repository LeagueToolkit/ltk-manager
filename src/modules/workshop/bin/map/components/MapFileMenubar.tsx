import { ArrowArcLeftIcon, ArrowArcRightIcon, FloppyDiskIcon } from "@phosphor-icons/react";
import type { RefObject } from "react";

import { useToast } from "@/components";
import { errorMessage, m } from "@/i18n";
import { CommandMenubar, documentHistory, documentSave, MENU_SEPARATOR } from "@/modules/editor";
import { shortcutOf } from "@/modules/keys";

import { useMapMenus } from "../hooks/useMapMenus";
import { useMapScene } from "../state/mapScene";

interface MapFileMenubarProps {
  /** The editor's id for the tab, which the save, the history and the palette are keyed on. */
  readonly documentId: string;
  /** The tab, whose focus Alt and F10 move to the bar. */
  readonly keyScope: RefObject<HTMLElement | null>;
}

/**
 * The menu bar of a map file's tab, which has no object and so no `ObjectMenuContext`. "Menu bar"
 * in docs/ux/MAP_EDITOR.md.
 */
export function MapFileMenubar({ documentId, keyScope }: MapFileMenubarProps) {
  const { editable } = useMapScene();
  const toast = useToast();
  const map = useMapMenus(false);

  const save = () => {
    void documentSave(documentId)?.().catch((error: unknown) => {
      toast.error(m.editor_save_failed_hint(), errorMessage(error));
    });
  };

  return (
    <div className="min-w-0 flex-3">
      <CommandMenubar
        aria-label={m.workshop_bin_menu_map_label()}
        keyScope={keyScope}
        documentId={documentId}
        data-ui="MapFileMenubar"
        menus={[
          {
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
              },
              MENU_SEPARATOR,
              ...map.file,
            ],
          },
          {
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
                run: editable ? () => documentHistory(documentId)?.("undo", null) : null,
              },
              {
                kind: "command",
                id: "redo",
                title: m.workshop_bin_menu_redo_action(),
                icon: <ArrowArcRightIcon className="size-4" />,
                shortcut: shortcutOf("editor.redo"),
                run: editable ? () => documentHistory(documentId)?.("redo", null) : null,
              },
              MENU_SEPARATOR,
              ...map.edit,
            ],
          },
          map.insert,
          map.tools,
          {
            id: "view",
            title: m.workshop_bin_menu_view_label(),
            className: "w-64",
            items: map.view,
          },
          map.map,
        ]}
      />
      {map.dialogs}
    </div>
  );
}
