import { ArrowDownIcon, ArrowUpIcon, ClockIcon, TextAaIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button, TogglePill } from "@/components";
import {
  useWorkshopFilterStore,
  type WorkshopSortDirection,
  type WorkshopSortField,
} from "@/stores";

interface SortOption {
  field: WorkshopSortField;
  label: string;
  icon: ReactNode;
  initialDirection: WorkshopSortDirection;
  directionLabels: Record<WorkshopSortDirection, string>;
}

const SORT_OPTIONS: SortOption[] = [
  {
    field: "name",
    label: "Name",
    icon: <TextAaIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "asc",
    directionLabels: { asc: "A–Z", desc: "Z–A" },
  },
  {
    field: "lastModified",
    label: "Last Modified",
    icon: <ClockIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "desc",
    directionLabels: { asc: "Oldest", desc: "Newest" },
  },
];

function reverse(direction: WorkshopSortDirection): WorkshopSortDirection {
  return direction === "asc" ? "desc" : "asc";
}

export function WorkshopSortOptions() {
  const { sort, setSort } = useWorkshopFilterStore();

  const selectOption = (option: SortOption) => {
    if (sort.field === option.field) {
      setSort({ field: option.field, direction: reverse(sort.direction) });
      return;
    }
    setSort({ field: option.field, direction: option.initialDirection });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {SORT_OPTIONS.map((option) => (
        <TogglePill
          key={option.field}
          label={option.label}
          icon={option.icon}
          active={sort.field === option.field}
          onClick={() => selectOption(option)}
        />
      ))}
    </div>
  );
}

/** Flips the active sort, labelled with what the current direction means. */
export function WorkshopSortDirectionToggle() {
  const { sort, setSort } = useWorkshopFilterStore();
  const option = SORT_OPTIONS.find((o) => o.field === sort.field);

  if (!option) return null;

  const icon = sort.direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />;

  return (
    <Button
      variant="ghost"
      size="xs"
      compact
      onClick={() => setSort({ field: sort.field, direction: reverse(sort.direction) })}
      right={icon}
      className="font-normal text-accent-300 hover:bg-accent-500/15 hover:text-accent-200"
    >
      {option.directionLabels[sort.direction]}
    </Button>
  );
}
