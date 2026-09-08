import { Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { useState } from "react";

import { ContextMenu, Dialog } from "@/components";
import { usePatcherStatus } from "@/modules/patcher";

import { useDeleteFolder, useRenameFolder, useToggleFolder } from "../api";
import { FolderNameForm } from "./FolderNameForm";

interface FolderContextMenuProps {
  folderId: string;
  folderName: string;
  children: React.ReactNode;
}

export function FolderContextMenu({ folderId, folderName, children }: FolderContextMenuProps) {
  const deleteFolder = useDeleteFolder();
  const toggleFolder = useToggleFolder();
  const renameFolder = useRenameFolder();
  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger data-folder-item className="h-full">
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
              <ContextMenu.Item
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => setRenameOpen(true)}
              >
                Rename
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                icon={<Power className="h-4 w-4" />}
                disabled={isPatcherActive}
                onClick={() => toggleFolder.mutate({ folderId, enabled: true })}
              >
                Enable All
              </ContextMenu.Item>
              <ContextMenu.Item
                icon={<PowerOff className="h-4 w-4" />}
                disabled={isPatcherActive}
                onClick={() => toggleFolder.mutate({ folderId, enabled: false })}
              >
                Disable All
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                icon={<Trash2 className="h-4 w-4" />}
                variant="danger"
                onClick={() => deleteFolder.mutate(folderId)}
              >
                Delete
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <Dialog.Root open={renameOpen} onOpenChange={setRenameOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Overlay size="sm">
            <div className="p-5">
              <Dialog.Title>Rename Folder</Dialog.Title>
              <div className="mt-3">
                <FolderNameForm
                  initialName={folderName}
                  submitLabel="Rename"
                  isPending={renameFolder.isPending}
                  onSubmit={(newName) =>
                    renameFolder.mutate(
                      { folderId, newName },
                      { onSuccess: () => setRenameOpen(false) },
                    )
                  }
                  onCancel={() => setRenameOpen(false)}
                />
              </div>
            </div>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
