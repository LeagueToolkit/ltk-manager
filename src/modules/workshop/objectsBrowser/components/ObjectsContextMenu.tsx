import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  FileIcon,
  HashIcon,
  MagnifyingGlassIcon,
  PathIcon,
} from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";

import { useShowInFile } from "../../bin/links/hooks/useShowInFile";
import type { OpenIntent } from "../../palette/utils/types";
/* The leaf rather than the references barrel, which reaches this module back through
   the documents registry mid-evaluation. */
import { objectReferences, useFindReferences } from "../../references/api/useFindReferences";
import { declarationOf } from "../hooks/useOpenObjectNode";
import type { ObjectTreeNode } from "../utils/objectTree";

interface ObjectsContextMenuProps {
  /** The row the menu was opened on. Absent while it has never been opened. */
  node: ObjectTreeNode | null;
  onOpen: (node: ObjectTreeNode, intent: OpenIntent) => void;
  /** Retries the object's failed preview. Absent when the preview did not fail. */
  onRetryPreview?: () => void;
}

/**
 * The objects tree's one menu, aimed at whichever row opened it.
 *
 * "What a row opens" in docs/ux/PROJECT_EDITOR.md. A prefix is a fold of the tree and
 * has a path to copy and nothing else.
 */
export function ObjectsContextMenu({ node, onOpen, onRetryPreview }: ObjectsContextMenuProps) {
  const copy = useCopyToClipboard();
  const showInFile = useShowInFile();
  const find = useFindReferences();

  if (node?.type === "prefix") {
    if (node.unnamed) return null;
    return (
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="w-56">
            <ContextMenu.Item
              icon={<PathIcon className="h-4 w-4" />}
              onClick={() => void copy(node.id, m.workshop_bin_path_label())}
            >
              {m.workshop_objects_copy_path_action()}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    );
  }

  if (node?.type !== "object") return null;
  const declaration = declarationOf(node);
  if (!declaration) return null;
  const classUnnamed = declaration.class === declaration.classHash;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="w-56">
          <ContextMenu.Item
            icon={<ArrowSquareOutIcon className="h-4 w-4" />}
            onClick={() => onOpen(node, "default")}
          >
            {m.workshop_objects_open_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ArrowSquareOutIcon className="h-4 w-4" />}
            onClick={() => onOpen(node, "beside")}
          >
            {m.workshop_objects_open_beside_action()}
          </ContextMenu.Item>
          {onRetryPreview && (
            <ContextMenu.Item
              icon={<ArrowClockwiseIcon className="h-4 w-4" />}
              onClick={onRetryPreview}
            >
              {m.workshop_objects_preview_retry_one_action()}
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<FileIcon className="h-4 w-4" />}
            onClick={() => showInFile(declaration.asset, node.objectHash, declaration.file)}
          >
            {m.workshop_objects_show_in_file_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<MagnifyingGlassIcon className="h-4 w-4" />}
            onClick={() => find(objectReferences(node.objectHash, node.path))}
          >
            {m.workshop_references_find_object_action()}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<PathIcon className="h-4 w-4" />}
            onClick={() => void copy(node.path, m.workshop_bin_path_label())}
          >
            {m.workshop_objects_copy_path_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<HashIcon className="h-4 w-4" />}
            onClick={() => void copy(node.objectHash, m.workshop_bin_hash_label())}
          >
            {m.workshop_objects_copy_hash_action()}
          </ContextMenu.Item>
          {classUnnamed && (
            <ContextMenu.Item
              icon={<HashIcon className="h-4 w-4" />}
              onClick={() => void copy(declaration.classHash, m.workshop_bin_hash_label())}
            >
              {m.workshop_objects_copy_class_hash_action()}
            </ContextMenu.Item>
          )}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
