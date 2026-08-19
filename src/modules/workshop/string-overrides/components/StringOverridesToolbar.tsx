import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";

import { Field, IconButton, Tooltip } from "@/components";

interface StringOverridesToolbarProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  onAdd: () => void;
}

/** Filter and add, sized for the 36px tab strip the document portals into. */
export function StringOverridesToolbar({
  filter,
  onFilterChange,
  onAdd,
}: StringOverridesToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <Field.Root className="relative w-44">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
        <Field.Control
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter overrides..."
          className="h-7 pr-7 pl-7 text-xs"
        />
        {filter && (
          <IconButton
            icon={<XIcon weight="bold" className="h-3.5 w-3.5" />}
            variant="transparent"
            size="xs"
            compact
            onClick={() => onFilterChange("")}
            aria-label="Clear filter"
            className="absolute top-1/2 right-1 h-5 w-5 -translate-y-1/2"
          />
        )}
      </Field.Root>

      <Tooltip content="Add override">
        <IconButton
          icon={<PlusIcon weight="bold" className="h-4 w-4" />}
          variant="ghost"
          size="xs"
          compact
          onClick={onAdd}
          aria-label="Add override"
        />
      </Tooltip>
    </div>
  );
}
