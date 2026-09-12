import {
  ArrowBendDoubleUpRightIcon,
  ArrowSquareOutIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderOpenIcon,
  TabsIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { IgnoreMatch } from "@/lib/tauri";
import { api } from "@/lib/tauri";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import {
  extensionIgnoreLine,
  fileIgnoreLine,
  folderIgnoreLine,
  isOwnLine,
  useIgnoreRowActions,
} from "../ignore-rules";
import { isPropertyBin, useOpenInRitobin, useRitobinIntegration } from "../preview";
import type { ContentTreeNode, FileNode } from "../utils/contentTree";

interface ContentTreeContextMenuProps {
  /** The row the menu was opened on. Absent while it has never been opened. */
  node: ContentTreeNode | null;
  projectPath: string;
  layerName: string;
  /** Opens a file row, the way a double click on it would. */
  onOpen?: (node: FileNode) => void;
  /** Asks for the row to go. The confirmation is the tree's, not this menu's. */
  onDelete?: (node: ContentTreeNode) => void;
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
  onDelete,
}: ContentTreeContextMenuProps) {
  const copy = useCopyToClipboard();
  const ritobin = useRitobinIntegration();
  const openInRitobin = useOpenInRitobin();

  if (!node) return null;

  const relativePath = node.type === "dir" ? node.path : node.entry.relativePath;
  const absolutePath = `${projectPath}/content/${layerName}/${relativePath}`;
  const file = node.type === "file" ? node : null;
  const bin = file !== null && isPropertyBin(fileKindFromPath(file.name)) && ritobin.data === true;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="w-52">
          {file && onOpen && (
            <ContextMenu.Item icon={<TabsIcon className="h-4 w-4" />} onClick={() => onOpen(file)}>
              {m.workshop_tree_open_action()}
            </ContextMenu.Item>
          )}
          {bin && (
            <ContextMenu.Item
              icon={<ArrowSquareOutIcon className="h-4 w-4" />}
              onClick={() =>
                openInRitobin.mutate({
                  asset: {
                    kind: "layer",
                    project: projectPath,
                    layer: layerName,
                    path: relativePath,
                  },
                  name: file.name,
                })
              }
            >
              {m.workshop_tree_open_vscode_action()}
            </ContextMenu.Item>
          )}
          {((file && onOpen) || bin) && <ContextMenu.Separator />}
          <ContextMenu.Item
            icon={<CopyIcon className="h-4 w-4" />}
            onClick={() => void copy(node.name, "name")}
          >
            {m.workshop_tree_copy_name_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ArrowBendDoubleUpRightIcon className="h-4 w-4" />}
            onClick={() => void copy(relativePath, "relative path")}
          >
            {m.workshop_tree_copy_path_action()}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<FolderOpenIcon className="h-4 w-4" />}
            onClick={() => {
              void api.revealInExplorer(absolutePath);
            }}
          >
            {m.workshop_tree_reveal_action()}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <IgnoreItems node={node} layerName={layerName} />
          {onDelete && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item
                icon={<TrashIcon className="h-4 w-4" />}
                variant="danger"
                shortcut="Del"
                onClick={() => onDelete(node)}
              >
                {m.workshop_tree_delete_action()}
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}

interface IgnoreItemsProps {
  node: ContentTreeNode;
  layerName: string;
}

/**
 * What the row offers to do to the project's rules.
 *
 * A row a rule already reached offers to undo it or to go read it, and never
 * both: a `!` line cannot bring back a file under an excluded folder, so an
 * exception written for the reader would work in one case and silently fail in
 * the other.
 */
function IgnoreItems({ node, layerName }: IgnoreItemsProps) {
  const { ignore, stopIgnoring, openRules } = useIgnoreRowActions();

  const relativePath = node.type === "dir" ? node.path : node.entry.relativePath;
  const isDir = node.type === "dir";
  const rule: IgnoreMatch | null = isDir ? node.ignoredBy : node.entry.ignoredBy;

  if (rule) {
    if (!isOwnLine(rule, layerName, { relativePath, isDir })) {
      return (
        <ContextMenu.Item
          icon={<EyeSlashIcon className="h-4 w-4" />}
          onClick={() => openRules(rule)}
        >
          {m.workshop_ignore_show_rule_action()}
        </ContextMenu.Item>
      );
    }

    return (
      <ContextMenu.Item
        icon={<EyeIcon className="h-4 w-4" />}
        onClick={() => void stopIgnoring(rule.pattern)}
      >
        {m.workshop_ignore_stop_action()}
      </ContextMenu.Item>
    );
  }

  if (isDir) {
    return (
      <ContextMenu.Item
        icon={<EyeSlashIcon className="h-4 w-4" />}
        onClick={() => void ignore(folderIgnoreLine(layerName, relativePath), "folder")}
      >
        {m.workshop_ignore_folder_action()}
      </ContextMenu.Item>
    );
  }

  const extension = extensionIgnoreLine(node.name);

  return (
    <>
      <ContextMenu.Item
        icon={<EyeSlashIcon className="h-4 w-4" />}
        onClick={() => void ignore(fileIgnoreLine(layerName, relativePath), "file")}
      >
        {m.workshop_ignore_file_action()}
      </ContextMenu.Item>
      {extension && (
        <ContextMenu.Item
          icon={<EyeSlashIcon className="h-4 w-4" />}
          onClick={() => void ignore(extension, "extension")}
        >
          {m.workshop_ignore_extension_action({ extension })}
        </ContextMenu.Item>
      )}
    </>
  );
}
