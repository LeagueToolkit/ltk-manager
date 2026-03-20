import { Lock } from "lucide-react";

import { Switch } from "@/components";
import type { ModLayer } from "@/lib/tauri";

interface LayerToggleListProps {
  layers: ModLayer[];
  onToggle: (layerName: string, enabled: boolean) => void;
  disabled?: boolean;
}

export function LayerToggleList({ layers, onToggle, disabled }: LayerToggleListProps) {
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);

  return (
    <div className="max-h-60 space-y-1 overflow-y-auto">
      {sorted.map((layer) => {
        const isBase = layer.name === "base";

        return (
          <div
            key={layer.name}
            className="flex items-center justify-between rounded-md border border-surface-700 bg-surface-800/50 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm text-surface-200">{layer.name}</span>
              <span className="ml-2 text-xs text-surface-500">Priority {layer.priority}</span>
            </div>
            {isBase ? (
              <Lock className="h-4 w-4 shrink-0 text-surface-500" />
            ) : (
              <Switch
                size="sm"
                disabled={disabled}
                checked={layer.enabled}
                onCheckedChange={(checked) => onToggle(layer.name, checked)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
