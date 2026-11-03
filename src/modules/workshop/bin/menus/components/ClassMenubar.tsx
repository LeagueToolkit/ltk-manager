import { KeyboardIcon } from "@phosphor-icons/react";
import { type ReactNode, use, useMemo } from "react";

import { m } from "@/i18n";
import { type CommandMenu, CommandMenubar, MENU_SEPARATOR } from "@/modules/editor";
import { openKeySheet, shortcutOf } from "@/modules/keys";

import { ShellHeaderPortal } from "../../shell/state/shellHeader";
import { useObjectMenus } from "../hooks/useObjectMenus";
import { ObjectMenuContext } from "../state/objectMenu";

interface ClassMenubarProps {
  readonly menus: readonly CommandMenu[];
  /** What the bar draws after its titles, such as a status chip. */
  readonly end?: ReactNode;
}

/** Keeps a key of the bar away from the view around it, whose keys a React parent answers. */
function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/**
 * The menu bar of an object tab, in the tab's header row. "Menu bar" in docs/ux/BIN_EDITOR.md.
 *
 * Mounted inside the scope of the view it serves and portaled up, so its items read the same
 * contexts as the view's own controls. Appends Keys and gestures to the View menu, which opens the
 * shortcut sheet on the view's own keys.
 */
export function ClassMenubar({ menus, end }: ClassMenubarProps) {
  const menu = use(ObjectMenuContext);
  const keyScope = menu?.keyScope;

  const shown = useMemo(
    () =>
      menus.map((each) =>
        each.id === "view"
          ? {
              ...each,
              items: [
                ...each.items,
                MENU_SEPARATOR,
                {
                  kind: "command" as const,
                  id: "keys",
                  title: m.workshop_bin_menu_keys_action(),
                  icon: <KeyboardIcon className="size-4" />,
                  shortcut: shortcutOf("app.keys"),
                  run: () => openKeySheet(keyScope?.current ?? null),
                },
              ],
            }
          : each,
      ),
    [menus, keyScope],
  );

  return (
    <ShellHeaderPortal slot="menubar">
      <div
        className="contents"
        onKeyDown={stopPropagation}
        onKeyUp={stopPropagation}
        onContextMenu={stopPropagation}
      >
        <CommandMenubar
          menus={shown}
          aria-label={m.workshop_bin_menu_bar_label()}
          keyScope={keyScope}
          documentId={menu?.documentId ?? null}
          end={end}
          data-ui="ClassMenubar"
        />
      </div>
    </ShellHeaderPortal>
  );
}

/** The bar of a class that draws no controls of its own: File, Edit and View. */
export function ObjectMenubar() {
  const base = useObjectMenus();

  return <ClassMenubar menus={[base.file(), base.edit(), base.view()]} />;
}
