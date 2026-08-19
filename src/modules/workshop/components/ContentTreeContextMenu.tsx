import { CopyIcon, FolderOpenIcon, PathIcon } from "@phosphor-icons/react";

import { ContextMenu, useToast } from "@/components";
import { api } from "@/lib/tauri";

import type { ContentTreeNode } from "../utils/contentTree";

interface ContentTreeContextMenuProps {
  /** The row the menu was opened on. Absent while it has never been opened. */
  node: ContentTreeNode | null;
  projectPath: string;
  layerName: string;
}

/**
 * The tree's one menu, aimed at whichever row opened it.
 *
 * A menu per row costs an instance for every row the virtualizer has mounted, and
 * rebuilds them all as the window slides.
 */
export function ContentTreeContextMenu({
  node,
  projectPath,
  layerName,
}: ContentTreeContextMenuProps) {
  const toast = useToast();

  if (!node) return null;

  const relativePath = node.type === "dir" ? node.path : node.entry.relativePath;
  const absolutePath = `${projectPath}/content/${layerName}/${relativePath}`;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.toast({ title: `Copied ${label}`, type: "success", timeout: 1500 });
    } catch {
      toast.toast({
        title: `Couldn't copy ${label} to clipboard`,
        type: "error",
        timeout: 2500,
      });
    }
  }

  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="w-52">
          <ContextMenu.Item
            icon={<CopyIcon className="h-4 w-4" />}
            onClick={() => copy(node.name, "name")}
          >
            Copy Name
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<PathIcon className="h-4 w-4" />}
            onClick={() => copy(relativePath, "path")}
          >
            Copy Relative Path
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<FolderOpenIcon className="h-4 w-4" />}
            onClick={() => {
              void api.revealInExplorer(absolutePath);
            }}
          >
            Reveal in Explorer
          </ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
