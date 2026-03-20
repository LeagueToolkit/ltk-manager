import { ChevronDown, Package, Play, Trash2, X } from "lucide-react";

import { Button, Menu } from "@/components";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { useFilteredProjects } from "../api/useFilteredProjects";
import { useTestProjects } from "../api/useTestProject";

export function ActionsMenu() {
  const selectedPaths = useWorkshopSelectionStore((s) => s.selectedPaths);
  const clear = useWorkshopSelectionStore((s) => s.clear);

  const filteredProjects = useFilteredProjects();
  const openBulkDeleteDialog = useWorkshopDialogsStore((s) => s.openBulkDeleteDialog);
  const openBulkPackDialog = useWorkshopDialogsStore((s) => s.openBulkPackDialog);
  const testProjects = useTestProjects();

  const selectedCount = selectedPaths.size;
  const hasSelection = selectedCount > 0;

  function getSelectedProjects() {
    return filteredProjects.filter((p) => selectedPaths.has(p.path));
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
    <Menu.Root>
      <Menu.Trigger
        disabled={!hasSelection}
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSelection}
            right={<ChevronDown className="h-3.5 w-3.5" />}
          >
            {hasSelection ? `Actions (${selectedCount})` : "Actions"}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup>
            <Menu.Item
              icon={<Trash2 className="h-4 w-4" />}
              variant="danger"
              onClick={handleDelete}
              disabled={!hasSelection}
            >
              {selectedCount > 1 ? `Delete ${selectedCount}` : "Delete"}
            </Menu.Item>
            <Menu.Item
              icon={<Package className="h-4 w-4" />}
              onClick={handlePack}
              disabled={!hasSelection}
            >
              {selectedCount > 1 ? `Pack ${selectedCount}` : "Pack"}
            </Menu.Item>
            <Menu.Item
              icon={<Play className="h-4 w-4" />}
              onClick={handleTest}
              disabled={!hasSelection}
            >
              {selectedCount > 1 ? `Test ${selectedCount}` : "Test"}
            </Menu.Item>
            {hasSelection && (
              <>
                <Menu.Separator />
                <Menu.Item icon={<X className="h-4 w-4" />} onClick={clear}>
                  Clear selection
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
