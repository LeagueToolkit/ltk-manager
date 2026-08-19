import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarPlusIcon,
  ListNumbersIcon,
  TextAaIcon,
  ToggleRightIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button, ChampionIcon, TogglePill } from "@/components";
import { type SortDirection, type SortField, useLibraryFilterStore } from "@/stores";

interface SortOption {
  field: SortField;
  label: string;
  icon: ReactNode;
  initialDirection: SortDirection;
  /** Set only on the fields the user can reverse, keyed by what each direction means. */
  directionLabels?: Record<SortDirection, string>;
}

const SORT_OPTIONS: SortOption[] = [
  {
    field: "priority",
    label: "Priority",
    icon: <ListNumbersIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "desc",
  },
  {
    field: "name",
    label: "Name",
    icon: <TextAaIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "asc",
    directionLabels: { asc: "A–Z", desc: "Z–A" },
  },
  {
    field: "champion",
    label: "Champion",
    icon: <ChampionIcon className="h-4 w-4" />,
    initialDirection: "asc",
    directionLabels: { asc: "A–Z", desc: "Z–A" },
  },
  {
    field: "installedAt",
    label: "Date Added",
    icon: <CalendarPlusIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "desc",
    directionLabels: { asc: "Oldest", desc: "Newest" },
  },
  {
    field: "enabled",
    label: "Enabled",
    icon: <ToggleRightIcon weight="bold" className="h-4 w-4" />,
    initialDirection: "asc",
  },
];

function reverse(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

export function SortOptions() {
  const { sort, setSort } = useLibraryFilterStore();

  const selectOption = (option: SortOption) => {
    if (sort.field === option.field && option.directionLabels) {
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
export function SortDirectionToggle() {
  const { sort, setSort } = useLibraryFilterStore();
  const option = SORT_OPTIONS.find((o) => o.field === sort.field);

  if (!option?.directionLabels) return null;

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
