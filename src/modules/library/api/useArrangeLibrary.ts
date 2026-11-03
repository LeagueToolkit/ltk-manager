import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import {
  arrangedFolderOrder,
  keptSortLabel,
  keptSortOf,
  LOAD_ORDER,
  sortMods,
} from "@/modules/library/utils";

import { useLibraryFilterActions, useLibrarySort } from "../state";
import { useFolderOrder, useFolders, useInstalledMods } from "./queries";
import { useEffectiveCategories } from "./useEffectiveCategories";
import { useSortContext } from "./useFilteredMods";
import { useReorderFolders } from "./useMoveMod";
import { useReorderMods } from "./useReorderMods";
import { useSetKeptSort } from "./useSetKeptSort";

/**
 * Writes the view's sort into the load order, once or for good.
 *
 * `arrange` resequences every folder by the sort the library is drawn in, and the folders
 * themselves under the name sort, then returns the view to the load order. `keep` sets
 * that sort as the one every folder keeps, where the sort is one a folder can keep.
 */
export function useArrangeLibrary() {
  const sort = useLibrarySort();
  const { setSort } = useLibraryFilterActions();
  const { data: mods = [] } = useInstalledMods();
  const { data: folders } = useFolders();
  const { data: folderOrder } = useFolderOrder();
  const context = useSortContext(useEffectiveCategories(mods));
  const reorderMods = useReorderMods();
  const reorderFolders = useReorderFolders();
  const setKeptSort = useSetKeptSort();
  const toast = useToast();

  const keptSort = keptSortOf(sort);

  const arrange = () => {
    const order = sortMods(mods, sort, context).map((mod) => mod.id);

    reorderMods.mutate(order, {
      onSuccess: () => {
        if (sort.field === "name" && folders && folderOrder) {
          reorderFolders.mutate(arrangedFolderOrder(folderOrder, folders, sort));
        }
        setSort(LOAD_ORDER);
      },
    });
  };

  const keep = () => {
    if (!keptSort || !folders) return;

    setKeptSort.mutate(
      { folderIds: folders.map((folder) => folder.id), keptSort },
      {
        onSuccess: () => {
          toast.success(
            m.library_kept_sort_kept_title(),
            m.library_kept_sort_kept_description({ sort: keptSortLabel(keptSort) ?? "" }),
          );
          setSort(LOAD_ORDER);
        },
      },
    );
  };

  return {
    arrange,
    keep,
    canKeep: keptSort !== null,
    isPending: reorderMods.isPending || reorderFolders.isPending || setKeptSort.isPending,
  } as const;
}
