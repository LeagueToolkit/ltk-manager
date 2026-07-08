import { Layers } from "lucide-react";

import { Button, Popover } from "@/components";
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

  const enabledCount = mod.layers.filter((l) => l.enabled).length;

  function handleToggle(layerName: string, enabled: boolean) {
    const layerStates: Record<string, boolean> = {};
    for (const layer of mod.layers) {
      layerStates[layer.name] = layer.name === layerName ? enabled : layer.enabled;
    }
    setModLayers.mutate({ modId: mod.id, layerStates });
  }

  // Popover content is portaled, so its clicks bubble up the React tree to the
  // card's onClick. Stopping propagation on this ancestor keeps the trigger and
  // popup from toggling the mod; `data-no-toggle` covers the in-DOM trigger too.
  return (
    <span data-no-toggle onClick={(e) => e.stopPropagation()}>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              variant="default"
              size="xs"
              compact
              disabled={disabled}
              left={<Layers className="h-3.5 w-3.5" />}
            >
              {enabledCount}/{mod.layers.length}
            </Button>
          }
        />
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6}>
            <Popover.Popup className="w-64">
              <Popover.Arrow />
              <div className="p-2">
                <div className="mb-1 flex items-center gap-2">
                  <Layers className="h-4 w-4 shrink-0 text-surface-400" />
                  <Popover.Title className="min-w-0 truncate">{mod.displayName}</Popover.Title>
                </div>
                <Popover.Description className="text-xs">
                  Choose which layers to apply. Enable the mod afterward to use them.
                </Popover.Description>
              </div>
              <LayerToggleList
                layers={mod.layers}
                onToggle={handleToggle}
                disabled={disabled}
                className="rounded-b-lg"
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
