import { CaretDownIcon, ChecksIcon, CheckSquareIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useHotkeys } from "react-hotkeys-hook";

import { ButtonGroup, IconButton, Kbd, Menu, Tooltip } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import type { useLibraryActions } from "@/modules/library/api";
import { useLibrarySelectionStore } from "@/stores";
import { isOverlayOpen } from "@/utils";

interface SelectionButtonProps {
  actions: ReturnType<typeof useLibraryActions>;
  visibleMods: InstalledMod[];
  /** True while the patcher is running or the library is still loading. */
  disabled: boolean;
}

const activeClass = "border-accent-500/40 bg-accent-500/15 text-accent-300 hover:bg-accent-500/20";

/**
 * Selects every visible mod on click, and holds the all-visible actions on its caret.
 *
 * Per "The toolbar button" in `docs/ux/LIBRARY.md`.
 */
export function SelectionButton({ actions, visibleMods, disabled }: SelectionButtonProps) {
  const selectedIds = useLibrarySelectionStore((s) => s.selectedIds);
  const addMany = useLibrarySelectionStore((s) => s.addMany);
  const clear = useLibrarySelectionStore((s) => s.clear);

  const hasSelection = selectedIds.size > 0;
  const enabledCount = visibleMods.reduce((n, m) => n + (m.enabled ? 1 : 0), 0);
  const bulkDisabled = disabled || actions.toggleMod.isPending;
  const canEnableAll = visibleMods.length > 0 && enabledCount < visibleMods.length;
  const canDisableAll = enabledCount > 0;

  const visibleIds = visibleMods.map((m) => m.id);
  // A selection survives a filter change, so an empty result still has something to clear.
  const clearsOnClick = visibleIds.every((id) => selectedIds.has(id));

  function handleToggleAll() {
    if (clearsOnClick) {
      clear();
      return;
    }
    addMany(visibleIds);
  }

  /* The health panel owns Ctrl+A while it is showing: "It takes focus while it
     is open" in docs/ux/MOD_HEALTH.md. So does every other overlay, for the
     same reason. */
  useHotkeys("ctrl+a, meta+a", () => !isOverlayOpen() && handleToggleAll(), {
    preventDefault: true,
    enabled: !disabled,
  });

  return (
    <ButtonGroup>
      <Tooltip
        content={
          <>
            {clearsOnClick ? "Clear selection" : "Select all"} <Kbd shortcut="Ctrl+A" />
          </>
        }
      >
        <IconButton
          icon={<CheckSquareIcon weight="bold" className="h-4 w-4" />}
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-pressed={hasSelection}
          aria-label={clearsOnClick ? "Clear selection" : "Select all mods"}
          onClick={handleToggleAll}
          className={hasSelection ? activeClass : undefined}
        />
      </Tooltip>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretDownIcon weight="bold" className="h-3.5 w-3.5" />}
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label="Bulk actions"
              className="w-auto px-1"
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="w-56">
              <Menu.Group>
                <Menu.GroupLabel>All visible</Menu.GroupLabel>
                <Menu.Item
                  icon={<ChecksIcon weight="bold" className="h-4 w-4" />}
                  disabled={bulkDisabled || !canEnableAll}
                  onClick={() => actions.handleSetEnabledForMods(visibleMods, true)}
                >
                  Enable
                </Menu.Item>
                <Menu.Item
                  icon={<ProhibitIcon weight="bold" className="h-4 w-4" />}
                  disabled={bulkDisabled || !canDisableAll}
                  onClick={() => actions.handleSetEnabledForMods(visibleMods, false)}
                >
                  Disable
                </Menu.Item>
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}
