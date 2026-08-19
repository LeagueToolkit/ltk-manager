import { type ReactNode } from "react";

import { Checkbox } from "./Checkbox";

export interface FilterOptionProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  icon?: ReactNode;
}

/** One row of a filter column, held to a single line so the rows keep one rhythm. */
export function FilterOption({ label, checked, onToggle, icon }: FilterOptionProps) {
  return (
    <Checkbox
      size="sm"
      className="items-center gap-2"
      checked={checked}
      onCheckedChange={onToggle}
      label={
        <span className="flex min-w-0 items-center gap-2">
          {icon && <span className="flex shrink-0 items-center">{icon}</span>}
          <span className="truncate">{label}</span>
        </span>
      }
    />
  );
}
