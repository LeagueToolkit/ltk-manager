import { CheckIcon, ColumnsIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button, Menu, RetainedContent } from "@/components";
import { m } from "@/i18n";
import {
  type LayoutNode,
  LeafDropZones,
  leafHolding,
  type LeafNode,
  leaves,
  PaneStrip,
  type PortalHost,
  PortalSlot,
  SplitLayout,
  TabDndProvider,
  usePortalHosts,
} from "@/modules/editor";
import { twMerge } from "@/utils";

import {
  useActivateShellPane,
  useApplyShellDrop,
  useCloseShellPane,
  useOpenShellPane,
  useOpenShellPanes,
  useResetShellLayout,
  useRestoreMaximizedShellLeaf,
  useSetShellSplitLayout,
  useShellActivePane,
  useShellLayout,
  useShellMaximizedLeaf,
  useShellPanes,
  useToggleMaximizedShellLeaf,
} from "../../../state";
import {
  isShellPaneId,
  SHELL_PANE_TITLE,
  type ShellKind,
  type ShellPaneId,
  type ShellPaneOf,
  shellPanesOf,
} from "../utils/shellPanes";

/** The box one pane draws, so no pane invents a surface of its own. DS-GROUND. */
const PANE = "flex min-h-0 min-w-0 flex-1 flex-col border border-surface-700/50 bg-surface-900";

/** What one pane draws: its body, and the controls its own strip carries. */
export interface ShellPane {
  body: ReactNode;
  onFocus?: () => void;
  /** Drawn in the strip after the tabs while this pane is the open one. */
  actions?: ReactNode;
  /** Whether the actions sit at the strip's right end, the default, or take the rest of it. */
  actionsWidth?: "end" | "rest";
}

/** What each pane of a `K` shell draws, one body per pane it holds, which the tree places. */
export type ShellPaneContent<K extends ShellKind> = Record<ShellPaneOf<K>, ShellPane>;

interface ShellPaneTreeProps<K extends ShellKind> {
  /** Which shell, whose own tree of its own panes is drawn (ADR-0036). */
  kind: K;
  content: ShellPaneContent<K>;
}

/**
 * A shell's panes as the split tree the editor grid runs on (ADR-0034).
 *
 * A pane is a tab of a leaf, so the same drag that moves a document between
 * editor groups moves a pane between panels, and the same seam resizes one.
 *
 * Each body renders here, into a portal host its panel adopts, rather than inside the
 * panel. Closing, maximizing or moving a pane rebuilds the panels, and a body mounted
 * in one would take the preview's WebGL context and every upload with it.
 */
export function ShellPaneTree<K extends ShellKind>({ kind, content }: ShellPaneTreeProps<K>) {
  const tree = useShellLayout(kind);
  const applyDrop = useApplyShellDrop(kind);
  const setSplitLayout = useSetShellSplitLayout(kind);
  const maximizedLeafId = useShellMaximizedLeaf(kind);
  const restoreMaximized = useRestoreMaximizedShellLeaf(kind);
  const hostOf = usePortalHosts();
  const bodies: Partial<Record<ShellPaneId, ShellPane>> = content;

  return (
    <TabDndProvider tree={tree} onDrop={applyDrop} overlay={PaneGhost}>
      <SplitLayout
        node={tree}
        seamVariant="gap"
        onLayoutChanged={setSplitLayout}
        renderLeaf={(leaf) => (
          <PaneLeaf key={leaf.id} kind={kind} leaf={leaf} content={content} hostOf={hostOf} />
        )}
        maximizedLeafId={maximizedLeafId}
        onRestore={restoreMaximized}
      />
      {/* After the tree, so a panel has adopted its host before a body's layout effects run. */}
      {heldPanes(tree, maximizedLeafId).map(({ pane, shown }) => {
        const focus = () => bodies[pane]?.onFocus?.();
        return createPortal(
          <RetainedContent
            active={shown}
            defer
            className="absolute inset-0 flex min-h-0 min-w-0 flex-col"
            onPointerDownCapture={focus}
            onFocusCapture={focus}
          >
            {bodies[pane]?.body}
          </RetainedContent>,
          hostOf(pane).node,
          pane,
        );
      })}
    </TabDndProvider>
  );
}

/** Every pane the tree holds, and whether it is the front tab of a panel on screen. */
function heldPanes(
  tree: LayoutNode,
  maximizedLeafId: string | null,
): { pane: ShellPaneId; shown: boolean }[] {
  return leaves(tree).flatMap((leaf) =>
    leaf.tabs.filter(isShellPaneId).map((pane) => ({
      pane,
      shown: leaf.activeTab === pane && (maximizedLeafId === null || maximizedLeafId === leaf.id),
    })),
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

/** One panel of the tree: its strip, and the hosts its panes' bodies render into. */
function PaneLeaf<K extends ShellKind>({
  kind,
  leaf,
  content,
  hostOf,
}: { leaf: LeafNode; hostOf: (pane: ShellPaneId) => PortalHost } & ShellPaneTreeProps<K>) {
  const panes = useShellPanes(kind, leaf.id);
  const active = useShellActivePane(kind, leaf.id);
  const activate = useActivateShellPane(kind);
  const close = useCloseShellPane(kind);
  const maximizedLeafId = useShellMaximizedLeaf(kind);
  const toggleMaximized = useToggleMaximizedShellLeaf(kind);
  /* A pane the tree holds is one the shell holds, which the sanitize on load keeps true. */
  const bodies: Partial<Record<ShellPaneId, ShellPane>> = content;

  return (
    <LeafDropZones leafId={leaf.id} tabs={panes} maximized={maximizedLeafId === leaf.id}>
      <div
        data-ui={`ShellPaneTree:${leaf.id}`}
        className={PANE}
        onPointerDownCapture={() => active !== null && bodies[active]?.onFocus?.()}
        onFocusCapture={() => active !== null && bodies[active]?.onFocus?.()}
      >
        <PaneStrip
          leafId={leaf.id}
          panes={panes.map((pane) => ({ id: pane, title: SHELL_PANE_TITLE[pane]() }))}
          activeId={active}
          onActivate={(id) => {
            if (!isShellPaneId(id)) return;
            activate(leaf.id, id);
            bodies[id]?.onFocus?.();
          }}
          onClose={(id) => isShellPaneId(id) && close(leaf.id, id)}
          onMaximize={() => toggleMaximized(leaf.id)}
          actions={active === null ? null : bodies[active]?.actions}
          actionsWidth={active === null ? undefined : bodies[active]?.actionsWidth}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {panes.map((pane) => (
            <PortalSlot key={pane} host={hostOf(pane)} />
          ))}
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
export function PanesMenu({ kind, className }: { kind: ShellKind; className?: string }) {
  const tree = useShellLayout(kind);
  const open = useOpenShellPanes(kind);
  const openPane = useOpenShellPane(kind);
  const closePane = useCloseShellPane(kind);
  const reset = useResetShellLayout(kind);

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
            {shellPanesOf(kind).map((pane) => (
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
