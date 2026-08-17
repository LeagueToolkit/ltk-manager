import { Plus } from "lucide-react";

import { Button, EmptyState } from "@/components";

interface StringOverridesEmptyStateProps {
  onAdd: () => void;
}

export function StringOverridesEmptyState({ onAdd }: StringOverridesEmptyStateProps) {
  return (
    <EmptyState
      size="sm"
      title="No overrides for this layer and locale"
      description="Add an override to change what a piece of in-game text says."
      action={
        <Button variant="outline" size="sm" left={<Plus className="h-4 w-4" />} onClick={onAdd}>
          Add Override
        </Button>
      }
    />
  );
}
