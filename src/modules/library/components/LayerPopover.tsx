import { Layers } from "lucide-react";

import { IconButton, Popover } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { useSetModLayers } from "@/modules/library/api";

import { LayerToggleList } from "./LayerToggleList";

interface LayerPopoverProps {
  mod: InstalledMod;
  disabled?: boolean;
}

export function LayerPopover({ mod, disabled }: LayerPopoverProps) {
  const setModLayers = useSetModLayers();

  if (mod.layers.length <= 1) return null;

  function handleToggle(layerName: string, enabled: boolean) {
    const layerStates: Record<string, boolean> = {};
    for (const layer of mod.layers) {
      layerStates[layer.name] = layer.name === layerName ? enabled : layer.enabled;
    }
    setModLayers.mutate({ modId: mod.id, layerStates });
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <IconButton
            icon={<Layers className="h-4 w-4" />}
            variant="ghost"
            size="md"
            disabled={disabled}
          />
        }
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup className="w-64 rounded-lg border border-surface-700 bg-surface-900 p-3 shadow-xl">
            <Popover.Arrow className="fill-surface-900 stroke-surface-700" />
            <p className="mb-2 text-xs font-medium tracking-wide text-surface-500 uppercase">
              Layers ({mod.layers.filter((l) => l.enabled).length}/{mod.layers.length})
            </p>
            <LayerToggleList layers={mod.layers} onToggle={handleToggle} disabled={disabled} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
