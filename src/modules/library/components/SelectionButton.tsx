import { CaretDownIcon, ChecksIcon, CheckSquareIcon, ProhibitIcon } from "@phosphor-icons/react";

import { ButtonGroup, IconButton, Kbd, Menu } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { shortcutOf, useKeys } from "@/modules/keys";
import type { useLibraryActions } from "@/modules/library/api";

import { useLibrarySelectionStore } from "../state";

interface SelectionButtonProps {
  actions: ReturnType<typeof useLibraryActions>;
  visibleMods: InstalledMod[];
  /** True while the patcher is running or the library is still loading. */
  disabled: boolean;
}

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

  /* `library.selectAll` excludes an open overlay: the health panel owns Ctrl+A while it is
     showing, per "It takes focus while it is open" in docs/ux/MOD_HEALTH.md. */
  useKeys("library", { "library.selectAll": handleToggleAll }, { enabled: !disabled });

  return (
    <ButtonGroup>
      <IconButton
        icon={<CheckSquareIcon />}
        variant="outline"
        size="md"
        disabled={disabled}
        pressed={hasSelection}
        aria-label={clearsOnClick ? "Clear selection" : "Select all mods"}
        onClick={handleToggleAll}
        tooltip={
          <>
            {clearsOnClick ? "Clear selection" : "Select all"}{" "}
            <Kbd shortcut={shortcutOf("library.selectAll")} />
          </>
        }
      />
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretDownIcon />}
              variant="outline"
              size="md"
              disabled={disabled}
              aria-label="Bulk actions"
              narrow
            />
          }
        />
        <Menu.Content className="w-56">
          <Menu.Group>
            <Menu.GroupLabel>All visible</Menu.GroupLabel>
            <Menu.Item
              icon={<ChecksIcon weight="bold" className="size-4" />}
              disabled={bulkDisabled || !canEnableAll}
              onClick={() => actions.handleSetEnabledForMods(visibleMods, true)}
            >
              Enable
            </Menu.Item>
            <Menu.Item
              icon={<ProhibitIcon weight="bold" className="size-4" />}
              disabled={bulkDisabled || !canDisableAll}
              onClick={() => actions.handleSetEnabledForMods(visibleMods, false)}
            >
              Disable
            </Menu.Item>
          </Menu.Group>
        </Menu.Content>
      </Menu.Root>
    </ButtonGroup>
  );
}
