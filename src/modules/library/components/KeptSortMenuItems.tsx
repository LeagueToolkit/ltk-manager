import { ArrowsDownUpIcon } from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { m } from "@/i18n";
import { useFolders, useSetKeptSort } from "@/modules/library/api";
import { KEPT_SORT_OPTIONS, keptSortFromValue, keptSortValue } from "@/modules/library/utils";

interface KeptSortMenuItemsProps {
  /** The folder the submenu sets, `root` for the mods outside every folder. */
  folderId: string;
}

/** The Keep sorted by submenu of a folder's menu: manual order, or one of the kept sorts. */
export function KeptSortMenuItems({ folderId }: KeptSortMenuItemsProps) {
  const { data: folders } = useFolders();
  const setKeptSort = useSetKeptSort();

  const current = folders?.find((folder) => folder.id === folderId)?.keptSort ?? null;

  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger icon={<ArrowsDownUpIcon className="size-4" />}>
        {m.library_kept_sort_menu_label()}
      </ContextMenu.SubmenuTrigger>
      <ContextMenu.SubmenuContent>
        <ContextMenu.RadioGroup
          value={keptSortValue(current)}
          onValueChange={(value) =>
            setKeptSort.mutate({
              folderIds: [folderId],
              keptSort: keptSortFromValue(value as string),
            })
          }
        >
          {KEPT_SORT_OPTIONS.map((option) => (
            <ContextMenu.RadioItem key={option.value} value={option.value}>
              {option.label()}
            </ContextMenu.RadioItem>
          ))}
        </ContextMenu.RadioGroup>
      </ContextMenu.SubmenuContent>
    </ContextMenu.SubmenuRoot>
  );
}
