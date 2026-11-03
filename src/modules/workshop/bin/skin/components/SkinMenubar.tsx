import { ArrowSquareOutIcon, BoneIcon, FunnelIcon, SortAscendingIcon } from "@phosphor-icons/react";
import { use } from "react";

import { m } from "@/i18n";
import type { CommandMenu } from "@/modules/editor";

import { ClassMenubar } from "../../menus/components/ClassMenubar";
import { useObjectMenus } from "../../menus/hooks/useObjectMenus";
import { ObjectMenuContext } from "../../menus/state/objectMenu";
import { usePaneCommandLookup } from "../../menus/state/paneCommands";
import { useSkinGate } from "../hooks/useSkinGate";
import { usePhysicsMenu, useSpellsMenu } from "../hooks/useSkinPaneMenus";
import { useSkinAnimationMenu, useSkinMenu } from "../hooks/useSkinPlayMenus";
import { useSkinFileItems, useSkinViewItems } from "../hooks/useSkinViewItems";
import { SkinChoiceContext } from "../state/skinChoice";
import { MENU_ICON as ICON, listSubmenu, offerCheck, offerCommand } from "../utils/offerItems";
import {
  CLIP_FILTER_COMMAND,
  CLIP_MASK_LIST,
  CLIP_OPEN_BESIDE_COMMAND,
  CLIP_OPEN_COMMAND,
  CLIP_SORT_DESCENDING_COMMAND,
  CLIP_SORT_LIST,
  CLIP_TABS,
  listedCommands,
  offerChecks,
  offerRadio,
} from "../utils/skinCommands";

/**
 * The menu bar of a skin: File, Edit, View, Animation, Skin, Physics and Spells.
 *
 * "Menu bar" in docs/ux/SKIN_EDITOR.md.
 */
export function SkinMenubar() {
  const base = useObjectMenus();
  const lookup = usePaneCommandLookup();
  const gate = useSkinGate(lookup);
  const fileItems = useSkinFileItems(lookup, gate);
  const viewItems = useSkinViewItems(lookup, gate);
  const animation = useSkinAnimationMenu(lookup, gate);
  const skin = useSkinMenu(lookup, gate);
  const physics = usePhysicsMenu(lookup, gate);
  const spells = useSpellsMenu(lookup, gate);

  return (
    <ClassMenubar
      menus={[
        base.file(fileItems),
        base.edit(),
        base.view(viewItems),
        animation,
        skin,
        physics,
        spells,
      ]}
    />
  );
}

/**
 * The menu bar of an `AnimationGraphData`: File, Edit, View and Clip.
 *
 * "Menu bar" in docs/ux/SKIN_EDITOR.md. The view has no viewport or transport.
 */
export function AnimationGraphMenubar() {
  const base = useObjectMenus();
  const menu = use(ObjectMenuContext);
  const choice = use(SkinChoiceContext);
  const lookup = usePaneCommandLookup();

  const blocked =
    menu?.mode === "properties"
      ? m.workshop_bin_menu_skin_layout_reason({ view: menu.layoutTitle ?? "" })
      : null;
  const sorts = listedCommands(lookup, CLIP_SORT_LIST);
  const masks = listedCommands(lookup, CLIP_MASK_LIST);
  const none = masks.every((mask) => mask.checked !== true);

  const clip: CommandMenu = {
    id: "clip",
    title: m.workshop_bin_menu_graph_clip_label(),
    className: "w-64",
    items: [
      offerCommand(
        CLIP_FILTER_COMMAND,
        m.workshop_bin_menu_graph_filter_action(),
        <FunnelIcon className={ICON} />,
        lookup(CLIP_FILTER_COMMAND),
        blocked,
        m.workshop_bin_menu_skin_section_reason(),
      ),
      {
        kind: "radio",
        id: "clip.tab",
        value: choice?.tab ?? "clips",
        options: CLIP_TABS.map((tab) => ({
          value: tab.value,
          title: tab.label(),
          disabled: choice === null || blocked !== null,
        })),
        onPick: (tab) => choice?.setTab(tab as (typeof CLIP_TABS)[number]["value"]),
      },
      { kind: "separator" },
      listSubmenu(
        CLIP_SORT_LIST,
        m.workshop_bin_menu_graph_sort_label(),
        <SortAscendingIcon className={ICON} />,
        [
          offerRadio("clip.sort.column", sorts),
          { kind: "separator" },
          offerCheck(
            CLIP_SORT_DESCENDING_COMMAND,
            m.workshop_bin_menu_graph_sort_descending_label(),
            undefined,
            lookup(CLIP_SORT_DESCENDING_COMMAND),
            null,
          ),
        ],
        blocked ?? (sorts.length === 0 ? m.workshop_bin_menu_graph_sort_reason() : null),
        m.workshop_bin_menu_graph_sort_reason(),
      ),
      { kind: "separator" },
      offerCommand(
        CLIP_OPEN_COMMAND,
        m.workshop_bin_clip_open_animation_action(),
        <ArrowSquareOutIcon className={ICON} />,
        lookup(CLIP_OPEN_COMMAND),
        blocked,
        m.workshop_bin_menu_graph_pick_reason(),
      ),
      offerCommand(
        CLIP_OPEN_BESIDE_COMMAND,
        m.workshop_bin_clip_open_animation_beside_action(),
        <ArrowSquareOutIcon className={ICON} />,
        lookup(CLIP_OPEN_BESIDE_COMMAND),
        blocked,
        m.workshop_bin_menu_graph_pick_reason(),
      ),
      { kind: "separator" },
      listSubmenu(
        CLIP_MASK_LIST,
        m.workshop_bin_menu_graph_mask_label(),
        <BoneIcon className={ICON} />,
        [
          {
            kind: "check",
            id: "clip.mask.none",
            title: m.workshop_bin_menu_graph_mask_none_label(),
            checked: none,
            run: () => choice?.setMask(null),
          },
          ...offerChecks("clip.mask.item", masks),
        ],
        blocked ?? (masks.length === 0 ? m.workshop_bin_menu_graph_mask_reason() : null),
        m.workshop_bin_menu_graph_mask_reason(),
      ),
    ],
  };

  return <ClassMenubar menus={[base.file(), base.edit(), base.view(), clip]} />;
}
