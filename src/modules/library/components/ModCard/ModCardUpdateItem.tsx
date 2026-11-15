import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";

import { Menu, useToast } from "@/components";
import { m } from "@/i18n";
import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../../api/keys";

/** Replacement archive picker for a library mod. */
export function ModCardUpdateItem({ modId }: { modId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const update = useMutation<InstalledMod, AppError, string>({
    mutationFn: async (filePath: string) => unwrapForQuery(await api.updateMod(modId, filePath)),
    onSuccess: () => toast.success(m.library_mod_update_success_title()),
    onError: (error) => toast.failure(m.library_mod_update_error_title(), error),
    onSettled: () => client.invalidateQueries({ queryKey: libraryKeys.all }),
  });

  async function chooseArchive() {
    try {
      const path = await open({
        multiple: false,
        filters: [
          { name: m.library_mod_update_archive_label(), extensions: ["fantome", "modpkg", "zip"] },
        ],
      });
      if (path) update.mutate(path);
    } catch (error) {
      console.error("Could not open mod update picker", error);
      toast.error(m.library_mod_update_error_title());
    }
  }

  return (
    <Menu.Item
      icon={<ArrowClockwiseIcon className="size-4" weight="bold" />}
      disabled={update.isPending}
      onClick={chooseArchive}
    >
      {m.library_mod_update_action()}
    </Menu.Item>
  );
}
