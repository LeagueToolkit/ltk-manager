import { ArrowSquareOutIcon, DotsThreeVerticalIcon, FilesIcon } from "@phosphor-icons/react";

import { IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useSidebarView } from "@/stores";

import { gameWadsDocument } from "../documents";
import { useOpenDocument } from "../state";
import { railViews } from "./railViews";

/**
 * The panel header's kebab: what this view offers that its body has no room for.
 *
 * DS-GLYPH-ROLE. Draws nothing for a view with nothing to offer, so the header of
 * the Explorer is the title alone.
 */
export function SidebarViewMenu() {
  const id = useSidebarView();
  const openDocument = useOpenDocument();

  const view = railViews().find((entry) => entry.id === id);
  const wide = view?.wide;
  if (!wide) return null;

  return (
    <Menu.Root>
      <Tooltip content={m.workshop_sidebar_menu_label()}>
        <Menu.Trigger
          render={
            <IconButton
              variant="ghost"
              size="xs"
              compact
              icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
              aria-label={m.workshop_sidebar_menu_label()}
              className="h-5 w-5"
            />
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4}>
          <Menu.Popup className="w-60">
            <Menu.Item
              icon={<ArrowSquareOutIcon className="h-4 w-4" />}
              onClick={() => openDocument(wide.document())}
            >
              {m.workshop_sidebar_open_tab_action({ title: wide.title })}
            </Menu.Item>

            {/* The tree folds the archives away, so the one route left to a
                single archive is the list this opens. */}
            {id === "game" && (
              <Menu.Item
                icon={<FilesIcon className="h-4 w-4" />}
                onClick={() => openDocument(gameWadsDocument())}
              >
                {m.workshop_game_wads_label()}
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
