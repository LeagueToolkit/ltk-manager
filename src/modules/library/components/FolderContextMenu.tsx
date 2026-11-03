import {
  PencilSimpleIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { ContextMenu } from "@/components";
import { m } from "@/i18n";

import { useDeleteFolder, useRenameFolder, useToggleFolder } from "../api";
import { FolderNameDialog } from "./FolderNameDialog";
import { KeptSortMenuItems } from "./KeptSortMenuItems";

interface FolderContextMenuProps {
  folderId: string;
  folderName: string;
  children: React.ReactNode;
}

export function FolderContextMenu({ folderId, folderName, children }: FolderContextMenuProps) {
  const deleteFolder = useDeleteFolder();
  const toggleFolder = useToggleFolder();
  const renameFolder = useRenameFolder();
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger data-folder-item className="h-full">
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item
            icon={<PencilSimpleIcon className="size-4" />}
            onClick={() => setRenameOpen(true)}
          >
            {m.library_folder_menu_rename_action()}
          </ContextMenu.Item>
          <KeptSortMenuItems folderId={folderId} />
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<ToggleRightIcon className="size-4" />}
            onClick={() => toggleFolder.mutate({ folderId, enabled: true })}
          >
            {m.library_folder_menu_enable_all_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ToggleLeftIcon className="size-4" />}
            onClick={() => toggleFolder.mutate({ folderId, enabled: false })}
          >
            {m.library_folder_menu_disable_all_action()}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<TrashIcon className="size-4" />}
            variant="danger"
            onClick={() => deleteFolder.mutate(folderId)}
          >
            {m.library_folder_menu_delete_action()}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
      <FolderNameDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={m.library_folder_rename_title()}
        submitLabel={m.library_folder_rename_action()}
        initialName={folderName}
        isPending={renameFolder.isPending}
        onSubmit={(newName) =>
          renameFolder.mutate({ folderId, newName }, { onSuccess: () => setRenameOpen(false) })
        }
      />
    </>
  );
}
