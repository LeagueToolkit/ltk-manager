import {
  CaretUpIcon,
  ChecksIcon,
  FoldersIcon,
  HeartbeatIcon,
  ProhibitIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { Button, IconButton, Menu, Tooltip } from "@/components";
import { m, Marked } from "@/i18n";
import type { HealthCheckReadiness, InstalledMod } from "@/lib/tauri";
import { shortcutOf, useKeys } from "@/modules/keys";
import { useSelectionActions } from "@/modules/library/api";

import { useLibrarySelectionStore } from "../state";
import { MoveToFolderItems } from "./MoveToFolderMenu";

/** What the press will do, or what it is waiting on before it can. */
const CHECK_HINTS: Record<HealthCheckReadiness, () => string> = {
  ready: m.library_selection_check_ready_hint,
  syncing: m.library_selection_check_syncing_hint,
  unsynced: m.library_selection_check_unsynced_hint,
};

interface SelectionActionBarProps {
  visibleMods: InstalledMod[];
}

/**
 * What the selection carries, over the library while anything is picked.
 *
 * Per "What a selection carries" in `docs/ux/LIBRARY.md`.
 */
export function SelectionActionBar({ visibleMods }: SelectionActionBarProps) {
  const selectedIds = useLibrarySelectionStore((s) => s.selectedIds);
  const actions = useSelectionActions();

  /* `library.clearSelection` excludes an open overlay: the health panel, an uninstall
     confirmation, a mod's details and a card menu each take Escape as "close this". */
  useKeys("library", { "library.clearSelection": actions.clear });

  const visibleSelectedCount = useMemo(
    () => visibleMods.reduce((n, m) => n + (selectedIds.has(m.id) ? 1 : 0), 0),
    [visibleMods, selectedIds],
  );
  const hiddenCount = actions.count - visibleSelectedCount;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-6">
      <div className="pointer-events-auto flex max-w-full animate-slide-up flex-wrap items-center gap-1 rounded-xl border border-surface-700 bg-surface-800/95 p-1.5 shadow-glass backdrop-blur-md">
        <IconButton
          icon={<XIcon />}
          size="md"
          onClick={actions.clear}
          aria-label={m.library_selection_clear_action()}
          tooltip={m.library_selection_clear_hint({
            key: shortcutOf("library.clearSelection"),
          })}
        />

        <span className="px-2 text-sm whitespace-nowrap text-surface-200 select-none">
          <Marked text={m.library_selection_count_label({ count: actions.count })}>
            {(count) => <span className="font-semibold text-accent-400">{count}</span>}
          </Marked>
          {hiddenCount > 0 && (
            <span className="ml-1 text-surface-500">
              {m.library_selection_hidden_label({ count: hiddenCount })}
            </span>
          )}
        </span>

        <div className="mx-1 h-6 w-px bg-surface-700" />

        <Button
          variant="ghost"
          onClick={actions.enable}
          disabled={!actions.canEnable}
          left={<ChecksIcon weight="bold" className="size-4" />}
        >
          {m.library_selection_enable_action({ count: actions.count })}
        </Button>

        <Button
          variant="ghost"
          onClick={actions.disable}
          disabled={!actions.canDisable}
          left={<ProhibitIcon weight="bold" className="size-4" />}
        >
          {m.library_selection_disable_action({ count: actions.count })}
        </Button>

        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                disabled={actions.count === 0}
                left={<FoldersIcon weight="bold" className="size-4" />}
                right={<CaretUpIcon weight="bold" className="size-3" />}
              >
                {m.library_selection_move_action()}
              </Button>
            }
          />
          <Menu.Content side="top" data-ui="SelectionActionBar:move">
            <MoveToFolderItems mods={actions.mods} />
          </Menu.Content>
        </Menu.Root>

        <div className="mx-1 h-6 w-px bg-surface-700" />

        <Tooltip content={CHECK_HINTS[actions.checkReadiness]()}>
          <Button
            variant="outline"
            onClick={actions.checkHealth}
            loading={actions.checkPending}
            disabled={actions.count === 0 || actions.checkReadiness !== "ready"}
            left={<HeartbeatIcon weight="bold" className="size-4" />}
          >
            {m.library_selection_check_action({ count: actions.count })}
          </Button>
        </Tooltip>

        <Button
          variant="filled"
          tone="danger"
          onClick={actions.uninstall}
          disabled={!actions.canUninstall}
          left={<TrashIcon weight="bold" className="size-4" />}
        >
          {m.library_selection_uninstall_action({ count: actions.count })}
        </Button>
      </div>
    </div>
  );
}
