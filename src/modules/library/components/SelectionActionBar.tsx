import { ChecksIcon, HeartbeatIcon, ProhibitIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { Button, IconButton, Tooltip } from "@/components";
import type { HealthCheckReadiness, InstalledMod } from "@/lib/tauri";
import { useSelectionActions } from "@/modules/library/api";
import { useLibrarySelectionStore } from "@/stores";
import { isOverlayOpen } from "@/utils";

/** What the press will do, or what it is waiting on before it can. */
const CHECK_HINTS: Record<HealthCheckReadiness, string> = {
  ready: "Check the selected mods for problems",
  syncing: "Syncing the hashtables a check needs. Try again in a moment.",
  unsynced: "The hashtables a check needs are not synced. Sync them in Settings.",
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

  /* The health panel, an uninstall confirmation, a mod's details and a card
     menu are all reachable with a selection standing, and Escape in each of
     them means "close this" rather than "drop the picks". */
  useHotkeys("escape", () => !isOverlayOpen() && actions.clear(), [actions.clear]);

  const visibleSelectedCount = useMemo(
    () => visibleMods.reduce((n, m) => n + (selectedIds.has(m.id) ? 1 : 0), 0),
    [visibleMods, selectedIds],
  );
  const hiddenCount = actions.count - visibleSelectedCount;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-6">
      <div className="pointer-events-auto flex max-w-full animate-slide-up flex-wrap items-center gap-1 rounded-xl border border-surface-700 bg-surface-800/95 p-1.5 shadow-glass backdrop-blur-md">
        <Tooltip content="Clear selection (Esc)">
          <IconButton
            icon={<XIcon weight="bold" className="h-4 w-4" />}
            variant="ghost"
            size="sm"
            onClick={actions.clear}
            aria-label="Clear selection"
          />
        </Tooltip>

        <span className="px-2 text-sm whitespace-nowrap text-surface-200 select-none">
          <span className="font-semibold text-accent-400">{actions.count}</span> selected
          {hiddenCount > 0 && <span className="ml-1 text-surface-500">· {hiddenCount} hidden</span>}
        </span>

        <div className="mx-1 h-6 w-px bg-surface-700" />

        <Button
          variant="ghost"
          size="sm"
          onClick={actions.enable}
          disabled={!actions.canEnable}
          left={<ChecksIcon weight="bold" className="h-4 w-4" />}
        >
          Enable {actions.count}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={actions.disable}
          disabled={!actions.canDisable}
          left={<ProhibitIcon weight="bold" className="h-4 w-4" />}
        >
          Disable {actions.count}
        </Button>

        <div className="mx-1 h-6 w-px bg-surface-700" />

        <Tooltip content={CHECK_HINTS[actions.checkReadiness]}>
          <Button
            variant="outline"
            size="sm"
            onClick={actions.checkHealth}
            loading={actions.checkPending}
            disabled={actions.count === 0 || actions.checkReadiness !== "ready"}
            left={<HeartbeatIcon weight="bold" className="h-4 w-4" />}
          >
            Check health {actions.count}
          </Button>
        </Tooltip>

        <Button
          variant="danger"
          size="sm"
          onClick={actions.uninstall}
          disabled={!actions.canUninstall}
          left={<TrashIcon weight="bold" className="h-4 w-4" />}
        >
          Uninstall {actions.count}
        </Button>
      </div>
    </div>
  );
}
