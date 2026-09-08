import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { IconButton, Popover } from "@/components";

import { useCreateFolder } from "../api";
import { FolderNameForm } from "./FolderNameForm";

export function CreateFolderDialog() {
  const [open, setOpen] = useState(false);
  const createFolder = useCreateFolder();

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <IconButton icon={<FolderPlus />} variant="ghost" size="sm" aria-label="New folder" />
        }
      />
      <Popover.Portal>
        <Popover.Positioner>
          <Popover.Popup className="w-64 p-3">
            <Popover.Title className="mb-2">New Folder</Popover.Title>
            <FolderNameForm
              submitLabel="Create"
              isPending={createFolder.isPending}
              onSubmit={(name) => createFolder.mutate(name, { onSuccess: () => setOpen(false) })}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
