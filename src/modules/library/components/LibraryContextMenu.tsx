import { FolderPlusIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { ContextMenu } from "@/components";
import { m } from "@/i18n";
import { useCreateFolder } from "@/modules/library/api";

import { FolderNameDialog } from "./FolderNameDialog";
import { KeptSortMenuItems } from "./KeptSortMenuItems";

interface LibraryContextMenuProps {
  /** The folder the ground belongs to: the open folder, or `root` on the library page. */
  folderId: string;
  children: React.ReactNode;
}

/** The menu a right click on the library ground opens: a new folder, and the ground's kept sort. */
export function LibraryContextMenu({ folderId, children }: LibraryContextMenuProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const createFolder = useCreateFolder();

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger className="flex min-h-0 flex-1 flex-col">
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item
            icon={<FolderPlusIcon className="size-4" />}
            onClick={() => setDialogOpen(true)}
          >
            {m.library_folder_menu_new_action()}
          </ContextMenu.Item>
          <KeptSortMenuItems folderId={folderId} />
        </ContextMenu.Content>
      </ContextMenu.Root>
      <FolderNameDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={m.library_folder_new_title()}
        submitLabel={m.library_folder_create_action()}
        isPending={createFolder.isPending}
        onSubmit={(name) => createFolder.mutate(name, { onSuccess: () => setDialogOpen(false) })}
      />
    </>
  );
}
