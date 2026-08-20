import {
  ArrowBendDoubleUpRightIcon,
  CopyIcon,
  FolderOpenIcon,
  TabsIcon,
} from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { api } from "@/lib/tauri";

import type { ContentTreeNode, FileNode } from "../utils/contentTree";

interface ContentTreeContextMenuProps {
  /** The row the menu was opened on. Absent while it has never been opened. */
  node: ContentTreeNode | null;
  projectPath: string;
  layerName: string;
  /** Opens a file row, the way a double click on it would. */
  onOpen?: (node: FileNode) => void;
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
  onOpen,
}: ContentTreeContextMenuProps) {
  const copy = useCopyToClipboard();

  if (!node) return null;

  const relativePath = node.type === "dir" ? node.path : node.entry.relativePath;
  const absolutePath = `${projectPath}/content/${layerName}/${relativePath}`;
  const file = node.type === "file" ? node : null;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="w-52">
          {file && onOpen && (
            <>
              <ContextMenu.Item
                icon={<TabsIcon className="h-4 w-4" />}
                onClick={() => onOpen(file)}
              >
                Open
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </>
          )}
          <ContextMenu.Item
            icon={<CopyIcon className="h-4 w-4" />}
            onClick={() => void copy(node.name, "name")}
          >
            Copy Name
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ArrowBendDoubleUpRightIcon className="h-4 w-4" />}
            onClick={() => void copy(relativePath, "relative path")}
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
