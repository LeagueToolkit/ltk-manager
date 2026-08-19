import {
  CaretDownIcon,
  CheckSquareIcon,
  PackageIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";

import { ButtonGroup, IconButton, Kbd, Menu, Tooltip } from "@/components";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { useFilteredProjects } from "../api/useFilteredProjects";
import { useTestProjects } from "../api/useTestProject";

const activeClass = "border-accent-500/40 bg-accent-500/15 text-accent-300 hover:bg-accent-500/20";

/** Selects every visible project on click, and holds the bulk actions on its caret. */
export function WorkshopSelectionButton() {
  const selectedPaths = useWorkshopSelectionStore((s) => s.selectedPaths);
  const selectAll = useWorkshopSelectionStore((s) => s.selectAll);
  const clear = useWorkshopSelectionStore((s) => s.clear);

  const filteredProjects = useFilteredProjects();
  const openBulkDeleteDialog = useWorkshopDialogsStore((s) => s.openBulkDeleteDialog);
  const openBulkPackDialog = useWorkshopDialogsStore((s) => s.openBulkPackDialog);
  const testProjects = useTestProjects();

  const selectedCount = selectedPaths.size;
  const hasSelection = selectedCount > 0;
  const allSelected =
    filteredProjects.length > 0 && filteredProjects.every((p) => selectedPaths.has(p.path));
  // A selection survives a filter change, so an empty result still has something to clear.
  const clearsOnClick = allSelected || filteredProjects.length === 0;
  const testTooltip = hasSelection
    ? `Test ${selectedCount} selected project${selectedCount === 1 ? "" : "s"}`
    : "Select projects to test them in game";

  function getSelectedProjects() {
    return filteredProjects.filter((p) => selectedPaths.has(p.path));
  }

  function handleToggleAll() {
    if (clearsOnClick) {
      clear();
      return;
    }
    selectAll(filteredProjects.map((p) => p.path));
  }

  function handleDelete() {
    const selected = getSelectedProjects();
    if (selected.length === 0) return;
    openBulkDeleteDialog(selected);
  }

  function handlePack() {
    const selected = getSelectedProjects();
    if (selected.length === 0) return;
    openBulkPackDialog(selected);
  }

  function handleTest() {
    const selected = getSelectedProjects();
    if (selected.length === 0) return;
    testProjects.mutate(
      { projects: selected.map((p) => ({ path: p.path, displayName: p.displayName })) },
      {
        onSuccess: () => clear(),
        onError: (err) => console.error("Failed to test projects:", err.message),
      },
    );
  }

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
          disabled={filteredProjects.length === 0 && !hasSelection}
          aria-pressed={hasSelection}
          aria-label={clearsOnClick ? "Clear selection" : "Select all projects"}
          onClick={handleToggleAll}
          className={hasSelection ? activeClass : undefined}
        />
      </Tooltip>
      <Tooltip content={testTooltip}>
        <IconButton
          icon={<PlayIcon weight="bold" className="h-4 w-4" />}
          variant="outline"
          size="sm"
          loading={testProjects.isPending}
          disabled={!hasSelection}
          aria-label="Test selected projects"
          onClick={handleTest}
        />
      </Tooltip>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretDownIcon weight="bold" className="h-3.5 w-3.5" />}
              variant="outline"
              size="sm"
              aria-label="Bulk actions"
              className="w-auto px-1"
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="w-56">
              <Menu.Group>
                <Menu.GroupLabel>
                  {hasSelection ? `${selectedCount} selected` : "Nothing selected"}
                </Menu.GroupLabel>
                <Menu.Item
                  icon={<PackageIcon weight="bold" className="h-4 w-4" />}
                  disabled={!hasSelection}
                  onClick={handlePack}
                >
                  Pack
                </Menu.Item>
                <Menu.Item
                  icon={<TrashIcon weight="bold" className="h-4 w-4" />}
                  variant="danger"
                  disabled={!hasSelection}
                  onClick={handleDelete}
                >
                  Delete
                </Menu.Item>
                {hasSelection && (
                  <>
                    <Menu.Separator />
                    <Menu.Item icon={<XIcon weight="bold" className="h-4 w-4" />} onClick={clear}>
                      Clear selection
                    </Menu.Item>
                  </>
                )}
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}
