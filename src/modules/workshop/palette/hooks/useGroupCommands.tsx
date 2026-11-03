import {
  ArrowCounterClockwiseIcon,
  ArrowLineRightIcon,
  CornersInIcon,
  CornersOutIcon,
  XCircleIcon,
  XIcon,
  XSquareIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { anyClosable, type LeafCloses, leafCloses } from "@/modules/editor";
import { shortcutOf } from "@/modules/keys";

import {
  useActiveLeafId,
  useHasClosedDocuments,
  useLeafActiveId,
  useLeafTabs,
  useMaximizedLeafId,
  usePinnedDocumentIds,
  useReopenClosedDocument,
  useRestoreMaximizedLeaf,
  useToggleMaximizedLeaf,
} from "../../state";
import type { ProjectCommand } from "../utils/types";

const GLYPH = "size-4";
const VIEW = "View";
/** What a batch close of pinned tabs alone says in place of its shortcut. */
const PINNED_THROUGH = "Every tab of the batch is pinned";

/** One close, with the documents it would take and what an empty batch says. */
interface CloseCommand extends Omit<ProjectCommand, "group" | "enabled" | "disabledReason"> {
  batch: readonly string[];
  empty: string;
}

/**
 * What the focused group's own tab strip offers, as commands.
 *
 * The four closes run through the queue that group's surface published. A dirty
 * document asks the same question it asks from the strip's own menu.
 */
export function useGroupCommands(): readonly ProjectCommand[] {
  const activeLeafId = useActiveLeafId();
  const tabs = useLeafTabs(activeLeafId);
  const activeId = useLeafActiveId(activeLeafId);
  const pinnedIds = usePinnedDocumentIds();
  const maximizedLeafId = useMaximizedLeafId();
  const toggleMaximized = useToggleMaximizedLeaf();
  const restoreMaximized = useRestoreMaximizedLeaf();
  const hasClosed = useHasClosedDocuments();
  const reopenClosed = useReopenClosedDocument();

  return useMemo<readonly ProjectCommand[]>(() => {
    const ids = tabs.map((tab) => tab.id);
    const at = activeId === null ? -1 : ids.indexOf(activeId);
    const others = ids.filter((id) => id !== activeId);
    const toRight = at < 0 ? [] : ids.slice(at + 1);
    const maximized = maximizedLeafId !== null;

    /* Read at the press rather than at the render. The answer comes from
       whichever surface holds the group at that moment. */
    const close = (which: (closes: LeafCloses) => void) => () => {
      const closes = leafCloses(activeLeafId);
      if (closes) which(closes);
    };

    const batches: readonly CloseCommand[] = [
      {
        id: "view.closeTab",
        title: "Close the tab",
        keywords: ["document", "strip"],
        icon: <XIcon className={GLYPH} />,
        batch: activeId === null ? [] : [activeId],
        empty: "Nothing open",
        run: close((closes) => activeId !== null && closes.closeOne(activeId)),
      },
      {
        id: "view.closeOthers",
        title: "Close the other tabs",
        keywords: ["rest", "strip"],
        icon: <XSquareIcon className={GLYPH} />,
        batch: activeId === null ? [] : others,
        empty: "No other tabs",
        run: close((closes) => activeId !== null && closes.closeOthers(activeId)),
      },
      {
        id: "view.closeToRight",
        title: "Close the tabs to the right",
        keywords: ["after", "strip"],
        icon: <ArrowLineRightIcon className={GLYPH} />,
        batch: toRight,
        empty: "Nothing to the right",
        run: close((closes) => activeId !== null && closes.closeToRight(activeId)),
      },
      {
        id: "view.closeAll",
        title: "Close all the tabs",
        keywords: ["every", "strip"],
        icon: <XCircleIcon className={GLYPH} />,
        batch: ids,
        empty: "Nothing open",
        run: close((closes) => closes.closeAll()),
      },
    ];

    return [
      ...batches.map(({ batch, empty, ...command }) => ({
        ...command,
        group: VIEW,
        enabled: anyClosable(batch, pinnedIds),
        disabledReason: batch.length === 0 ? empty : PINNED_THROUGH,
      })),
      {
        id: "view.reopenClosed",
        title: "Reopen the closed tab",
        group: VIEW,
        keywords: ["restore", "undo", "back", "strip"],
        icon: <ArrowCounterClockwiseIcon className={GLYPH} />,
        shortcut: shortcutOf("editor.reopenTab"),
        enabled: hasClosed,
        disabledReason: "Nothing closed yet",
        run: reopenClosed,
      },
      {
        id: "view.maximize",
        title: maximized ? "Restore the panel" : "Maximize the panel",
        group: VIEW,
        keywords: ["panel", "group", "fill", "grid"],
        icon: maximized ? (
          <CornersInIcon className={GLYPH} />
        ) : (
          <CornersOutIcon className={GLYPH} />
        ),
        enabled: maximized || ids.length > 0,
        disabledReason: "Nothing open",
        /* A panel of another group fills the grid, and the command gives the
           tree back rather than filling it with this one. */
        run: () => (maximized ? restoreMaximized() : toggleMaximized(activeLeafId)),
      },
    ];
  }, [
    activeId,
    activeLeafId,
    hasClosed,
    maximizedLeafId,
    pinnedIds,
    reopenClosed,
    restoreMaximized,
    tabs,
    toggleMaximized,
  ]);
}
