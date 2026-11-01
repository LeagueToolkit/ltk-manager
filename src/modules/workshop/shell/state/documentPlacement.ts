/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import {
  acceptsOpen,
  findLeaf,
  type LayoutNode,
  type LeafNode,
  leaves,
  neighbourLeaf,
  splitEmpty,
} from "@/modules/editor/layout";

import type { ContentDocument } from "../../documents/utils/contentDocument";
import type { ProjectEditor } from "./projectEditor";

/* An object tab is a preview document: ADR-0028. */
function isPreviewKind(kind: ContentDocument["kind"]): boolean {
  return kind === "preview" || kind === "object";
}

/**
 * The group a document opens into, with the layout that holds it.
 *
 * An explicit `leafId` wins, and anything that is not a preview lands in the
 * focused group. A preview opens in the group beside the one that asked for it,
 * so a browser keeps its own group and a walk through a tree never pushes it
 * off screen. A group with no neighbour splits one off to its right.
 *
 * A locked group takes neither, since neither gesture named it.
 */
export function openGroup(
  editor: ProjectEditor,
  document: ContentDocument,
  leafId?: string,
): { layout: LayoutNode; leafId: string } {
  const focused =
    findLeaf(editor.layout, leafId ?? editor.activeLeafId) ?? leaves(editor.layout)[0];
  /* A caller naming the group has consented to it, so a drop and an open into
     one group reach a locked group the way they always did. */
  if (leafId !== undefined) return { layout: editor.layout, leafId: focused.id };
  if (!isPreviewKind(document.kind)) return unlockedGroup(editor.layout, focused);

  /* An empty group has nothing to sit beside, so it takes the preview rather
     than splitting into two with one of them showing nothing. A group already
     showing previews is where the next one belongs, which is what keeps a walk
     continued from the preview itself out of the browser's strip. */
  if ((focused.tabs.length === 0 && acceptsOpen(focused)) || showsPreview(editor, focused)) {
    return { layout: editor.layout, leafId: focused.id };
  }

  const beside = neighbourLeaf(editor.layout, focused.id);
  if (beside && acceptsOpen(beside)) return { layout: editor.layout, leafId: beside.id };

  const split = splitEmpty(editor.layout, focused.id, "right");
  return { layout: split.tree, leafId: split.leafId };
}

/** Whether this group already shows a preview, which makes it the place for the next one. */
function showsPreview(editor: ProjectEditor, leaf: LeafNode): boolean {
  return (
    acceptsOpen(leaf) &&
    leaf.tabs.some((id) => {
      const kind = editor.documents[id]?.kind;
      return kind !== undefined && isPreviewKind(kind);
    })
  );
}

/*
 * The group behind a locked one: the next that takes an open, else a fresh one.
 *
 * Reading order rather than the tree's shape, so the document lands in the
 * group a reader would have reached for next. Every group being locked is what
 * mints one, which is the only way a lock adds a group to the screen.
 */
function unlockedGroup(
  layout: LayoutNode,
  focused: LeafNode,
): { layout: LayoutNode; leafId: string } {
  if (acceptsOpen(focused)) return { layout, leafId: focused.id };

  const open = leaves(layout).find(acceptsOpen);
  if (open) return { layout, leafId: open.id };

  const split = splitEmpty(layout, focused.id, "right");
  return { layout: split.tree, leafId: split.leafId };
}
