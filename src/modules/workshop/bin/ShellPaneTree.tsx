import { CheckIcon, ColumnsIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import {
  LeafDropZones,
  leafHolding,
  type LeafNode,
  PaneStrip,
  SplitLayout,
  TabDndProvider,
} from "@/modules/editor";

import {
  useActivateShellPane,
  useApplyShellDrop,
  useCloseShellPane,
  useOpenShellPane,
  useOpenShellPanes,
  useResetShellLayout,
  useSetShellSplitLayout,
  useShellActivePane,
  useShellLayout,
  useShellPanes,
} from "../state";
import { isShellPaneId, SHELL_PANE_IDS, SHELL_PANE_TITLE, type ShellPaneId } from "./shellPanes";

/** The box one pane draws, so no pane invents a surface of its own. DS-GROUND. */
const PANE =
  "flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-surface-700/50 bg-surface-900";

/** What one pane draws: its body, and the controls its own strip carries. */
export interface ShellPane {
  body: ReactNode;
  /** Drawn at the right end of the strip while this pane is the open one. */
  actions?: ReactNode;
}

/** What each pane of the shell draws, which the tree places and never reads. */
export type ShellPaneContent = Record<ShellPaneId, ShellPane>;

/**
 * The shell's panes as the split tree the editor grid runs on (ADR-0034).
 *
 * A pane is a tab of a leaf, so the same drag that moves a document between
 * editor groups moves a pane between panels, and the same seam resizes one.
 */
export function ShellPaneTree({ content }: { content: ShellPaneContent }) {
  const tree = useShellLayout();
  const applyDrop = useApplyShellDrop();
  const setSplitLayout = useSetShellSplitLayout();

  return (
    <TabDndProvider tree={tree} onDrop={applyDrop} overlay={PaneGhost}>
      <SplitLayout
        node={tree}
        onLayoutChanged={setSplitLayout}
        renderLeaf={(leaf) => <PaneLeaf key={leaf.id} leaf={leaf} content={content} />}
      />
    </TabDndProvider>
  );
}

/** The ghost under the pointer, which names the pane rather than redrawing it. */
function PaneGhost(paneId: string) {
  if (!isShellPaneId(paneId)) return null;
  return (
    <span className="rounded-sm bg-surface-800 px-2 py-0.5 font-sans text-xs font-medium tracking-wide text-surface-100 uppercase">
      {SHELL_PANE_TITLE[paneId]()}
    </span>
  );
}

/** One panel of the tree: its strip, and whichever of its panes is open. */
function PaneLeaf({ leaf, content }: { leaf: LeafNode; content: ShellPaneContent }) {
  const panes = useShellPanes(leaf.id);
  const active = useShellActivePane(leaf.id);
  const activate = useActivateShellPane();
  const close = useCloseShellPane();

  return (
    <LeafDropZones leafId={leaf.id} tabs={panes}>
      <div data-ui={`ShellPaneTree:${leaf.id}`} className={PANE}>
        <PaneStrip
          leafId={leaf.id}
          panes={panes.map((pane) => ({ id: pane, title: SHELL_PANE_TITLE[pane]() }))}
          activeId={active}
          onActivate={(id) => isShellPaneId(id) && activate(leaf.id, id)}
          onClose={(id) => isShellPaneId(id) && close(leaf.id, id)}
          actions={active === null ? null : content[active].actions}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {active !== null && content[active].body}
          {active === null && <NoPanes />}
        </div>
      </div>
    </LeafDropZones>
  );
}

/** What a panel whose last pane was closed says, which only the root leaf can be. */
function NoPanes() {
  return (
    <span className="flex flex-1 items-center justify-center px-2 text-center text-meta text-surface-400 select-none">
      {m.workshop_bin_panes_empty()}
    </span>
  );
}

/**
 * Which panes are open, and the way back to the arrangement they started in.
 *
 * A pane reopens into the panel the reader last touched rather than where it
 * was closed, because the panel it was closed from is the one the prune took.
 */
export function PanesMenu({ className }: { className?: string }) {
  const tree = useShellLayout();
  const open = useOpenShellPanes();
  const openPane = useOpenShellPane();
  const closePane = useCloseShellPane();
  const reset = useResetShellLayout();

  function toggle(pane: ShellPaneId) {
    const holder = leafHolding(tree, pane);
    if (holder === null) return openPane(pane);
    return closePane(holder.id, pane);
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            className={twMerge("font-sans", className)}
            left={<ColumnsIcon weight="bold" className="h-4 w-4" />}
          >
            {m.workshop_bin_panes_menu_label()}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup className="w-48">
            {SHELL_PANE_IDS.map((pane) => (
              <Menu.Item
                key={pane}
                icon={open.has(pane) && <CheckIcon weight="bold" className="h-4 w-4" />}
                onClick={() => toggle(pane)}
              >
                {SHELL_PANE_TITLE[pane]()}
              </Menu.Item>
            ))}
            <Menu.Separator />
            <Menu.Item onClick={reset}>{m.workshop_bin_panes_reset_action()}</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
