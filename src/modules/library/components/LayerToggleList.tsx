import { Lock } from "lucide-react";
import { twMerge } from "tailwind-merge";

import { Checkbox, Tooltip } from "@/components";
import type { ModLayer } from "@/lib/tauri";

interface LayerToggleListProps {
  layers: ModLayer[];
  onToggle: (layerName: string, enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function LayerToggleList({ layers, onToggle, disabled, className }: LayerToggleListProps) {
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);

  return (
    <div className={twMerge("max-h-60 overflow-y-auto bg-surface-900", className)}>
      {sorted.map((layer) => {
        const isBase = layer.name === "base";
        const name = (
          <div className="min-w-0 flex-1">
            <Tooltip content={layer.displayName} side="bottom">
              <span className="block truncate text-sm text-surface-200">{layer.displayName}</span>
            </Tooltip>
          </div>
        );

        if (isBase) {
          return (
            <div
              key={layer.name}
              className="flex border-collapse items-center gap-3 border border-surface-700 bg-surface-800/50 px-3 py-2 select-none"
            >
              {name}
              <Lock className="h-4 w-4 shrink-0 text-surface-500" />
            </div>
          );
        }

        return (
          <div
            key={layer.name}
            onClick={() => !disabled && onToggle(layer.name, !layer.enabled)}
            className={twMerge(
              "flex border-collapse items-center border-y border-surface-700 bg-surface-800/50 px-3 py-2 select-none",
              !disabled && "cursor-pointer hover:border-surface-600 hover:bg-surface-800",
              "last:rounded-b-md last:border-b-0",
            )}
          >
            {name}
            <Checkbox
              size="sm"
              checked={layer.enabled}
              disabled={disabled}
              tabIndex={-1}
              className="pointer-events-none"
            />
          </div>
        );
      })}
    </div>
  );
}
