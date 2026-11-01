/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import {
  findLeaf,
  leaves,
  mergeToSingleLeaf,
  setLeafLocked as applyLeafLock,
  setSplitLayout as applySplitLayout,
} from "@/modules/editor/layout";

import type { EditorSet } from "./editorRoot";
import { recordVisit, setProject } from "./projectUpdate";
import { pinnedFirst, reorderLeafTabs } from "./tabOrder";

/** What the editor does to its groups: focus, split, lock and maximize. */
export interface GroupActions {
  focusLeaf: (projectPath: string, leafId: string) => void;
  /** Writes what `onLayoutChanged` reported for one split. */
  setSplitLayout: (projectPath: string, splitId: string, layout: Record<string, number>) => void;
  /** Merges every strip into the focused leaf, in reading order. */
  resetLayout: (projectPath: string) => void;
  /** Locks or unlocks one group, which is what the strip's own control asks for. */
  setLeafLocked: (projectPath: string, leafId: string, locked: boolean) => void;
  /**
   * Fills the grid with one panel, or gives the tree back when it already fills it.
   *
   * Per "Maximizing a panel" in `docs/ux/PROJECT_EDITOR.md`.
   */
  toggleMaximizedLeaf: (projectPath: string, leafId: string) => void;
  /** Gives the tree back, which is what Esc asks for. */
  restoreMaximizedLeaf: (projectPath: string) => void;
}

/** These actions, closed over the writer of the store that holds them. */
export function createGroupActions(set: EditorSet): GroupActions {
  return {
    focusLeaf: (projectPath, leafId) =>
      setProject(set, projectPath, (editor) => {
        const leaf = findLeaf(editor.layout, leafId);
        if (!leaf || editor.activeLeafId === leafId) return null;

        const focused = { ...editor, activeLeafId: leafId };
        return leaf.activeTab ? recordVisit(focused, leaf.activeTab) : focused;
      }),

    setSplitLayout: (projectPath, splitId, layout) =>
      setProject(set, projectPath, (editor) => {
        const next = applySplitLayout(editor.layout, splitId, layout);
        return next === editor.layout ? null : { ...editor, layout: next };
      }),

    resetLayout: (projectPath) =>
      setProject(set, projectPath, (editor) => {
        const merged = mergeToSingleLeaf(editor.layout, editor.activeLeafId);
        if (merged === editor.layout && editor.maximizedLeafId === null) return null;

        /* The merge gathers each strip whole, so a pinned tab of the second
           group lands behind the first group's unpinned ones. */
        const leaf = leaves(merged)[0];
        const layout = reorderLeafTabs(merged, leaf.id, pinnedFirst(leaf.tabs, editor.pinned));
        return { ...editor, layout, activeLeafId: leaf.id, maximizedLeafId: null };
      }),

    setLeafLocked: (projectPath, leafId, locked) =>
      setProject(set, projectPath, (editor) => {
        const layout = applyLeafLock(editor.layout, leafId, locked);
        if (layout === editor.layout) return null;

        const activeLeafId = findLeaf(layout, editor.activeLeafId)
          ? editor.activeLeafId
          : leaves(layout)[0].id;
        return { ...editor, layout, activeLeafId };
      }),

    toggleMaximizedLeaf: (projectPath, leafId) =>
      setProject(set, projectPath, (editor) => {
        if (editor.maximizedLeafId === leafId) return { ...editor, maximizedLeafId: null };
        if (!findLeaf(editor.layout, leafId)) return null;
        return { ...editor, maximizedLeafId: leafId };
      }),

    restoreMaximizedLeaf: (projectPath) =>
      setProject(set, projectPath, (editor) =>
        editor.maximizedLeafId === null ? null : { ...editor, maximizedLeafId: null },
      ),
  };
}
