import { Globe, Plus } from "lucide-react";

import { Button } from "@/components";

interface StringOverridesEmptyStateProps {
  onAdd: () => void;
}

export function StringOverridesEmptyState({ onAdd }: StringOverridesEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-surface-600 bg-surface-800/40 px-6 py-10 text-center">
      <Globe className="h-8 w-8 text-surface-500" />
      <div>
        <p className="text-sm font-medium text-surface-200">
          No overrides for this layer and locale
        </p>
        <p className="mt-1 text-sm text-surface-400">
          Add an override to change what a piece of in-game text says. Start typing a field name to
          search every known string in the game.
        </p>
      </div>
      <Button variant="outline" size="sm" left={<Plus className="h-4 w-4" />} onClick={onAdd}>
        Add Override
      </Button>
    </div>
  );
}
