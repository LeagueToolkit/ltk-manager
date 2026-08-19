import { CaretDownIcon, ChecksIcon, CheckSquareIcon, ProhibitIcon } from "@phosphor-icons/react";

import { ButtonGroup, IconButton, Menu, Tooltip } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import type { useLibraryActions } from "@/modules/library/api";
import { useLibrarySelectionStore } from "@/stores";

interface SelectionButtonProps {
  actions: ReturnType<typeof useLibraryActions>;
  visibleMods: InstalledMod[];
  /** True while the patcher is running or the library is still loading. */
  disabled: boolean;
}

const activeClass = "border-accent-500/40 bg-accent-500/15 text-accent-300 hover:bg-accent-500/20";

/** Enters select mode on click, and holds the bulk actions on its caret. */
export function SelectionButton({ actions, visibleMods, disabled }: SelectionButtonProps) {
  const selectMode = useLibrarySelectionStore((s) => s.selectMode);
  const enterSelectMode = useLibrarySelectionStore((s) => s.enterSelectMode);
  const exitSelectMode = useLibrarySelectionStore((s) => s.exitSelectMode);

  const enabledCount = visibleMods.reduce((n, m) => n + (m.enabled ? 1 : 0), 0);
  const bulkDisabled = disabled || actions.toggleMod.isPending;
  const canEnableAll = visibleMods.length > 0 && enabledCount < visibleMods.length;
  const canDisableAll = enabledCount > 0;

  return (
    <ButtonGroup>
      <Tooltip content={selectMode ? "Done selecting" : "Pick individual mods to bulk-uninstall"}>
        <IconButton
          icon={<CheckSquareIcon weight="bold" className="h-4 w-4" />}
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-pressed={selectMode}
          aria-label={selectMode ? "Done selecting" : "Select mods"}
          onClick={selectMode ? exitSelectMode : enterSelectMode}
          className={selectMode ? activeClass : undefined}
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
