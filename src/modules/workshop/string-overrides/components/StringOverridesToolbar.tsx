import { Plus, Search, X } from "lucide-react";

import { Button, Field } from "@/components";

interface StringOverridesToolbarProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  onAdd: () => void;
}

export function StringOverridesToolbar({
  filter,
  onFilterChange,
  onAdd,
}: StringOverridesToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Field.Root className="relative w-56">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
        <Field.Control
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter overrides..."
          className="pr-8 pl-9"
        />
        {filter && (
          <button
            type="button"
            onClick={() => onFilterChange("")}
            aria-label="Clear filter"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-surface-500 transition-colors hover:text-surface-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </Field.Root>
      <Button variant="outline" size="sm" left={<Plus className="h-4 w-4" />} onClick={onAdd}>
        Add Override
      </Button>
    </div>
  );
}
