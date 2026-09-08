import { FloppyDiskIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";

import { IconButton, Tooltip, useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { api, type AppError, type AssetRef } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

interface SaveCopyActionProps {
  asset: AssetRef;
  /** The file name the dialog opens on, which is the tab's own title. */
  name: string;
}

/**
 * Write the open asset somewhere the user picks.
 *
 * The extract of one file, and deliberately not through the extractor: the user
 * names the file in a save dialog, so the naming rules the extractor applies to
 * a whole archive have nothing to decide. A modder with the texture already
 * open should not have to go back to the tree for it.
 */
export function SaveCopyAction({ asset, name }: SaveCopyActionProps) {
  const { success, error } = useToast();

  const saveCopy = useMutation<void, AppError, string>({
    meta: { silentError: true },
    mutationFn: mutationFn((destination: string) => api.saveAssetCopy(asset, destination)),
    onSuccess: () => success("Saved a copy", name),
    onError: (e) => error("Could not save a copy", errorSummary(e)),
  });

  async function handleClick() {
    const destination = await save({
      defaultPath: name,
      title: "Save a copy",
    });
    /* Dismissed, which is not a failure and gets no toast. */
    if (destination === null) return;
    saveCopy.mutate(destination);
  }

  return (
    <Tooltip content="Save a copy…">
      <IconButton
        icon={<FloppyDiskIcon className="h-4 w-4" />}
        variant="ghost"
        size="xs"
        compact
        onClick={() => void handleClick()}
        disabled={saveCopy.isPending}
        aria-label={`Save a copy of ${name}`}
      />
    </Tooltip>
  );
}
