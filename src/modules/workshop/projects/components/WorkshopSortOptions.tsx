import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  TextAaIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button, TogglePill } from "@/components";
import { m } from "@/i18n";

import {
  useSetWorkshopLocation,
  useWorkshopFilterActions,
  useWorkshopLocation,
  useWorkshopSort,
  type WorkshopLocationFilter,
  type WorkshopSortDirection,
  type WorkshopSortField,
} from "../../state";

interface SortOption {
  field: WorkshopSortField;
  label: string;
  icon: ReactNode;
  initialDirection: WorkshopSortDirection;
  directionLabels: Record<WorkshopSortDirection, string>;
}

function sortOptions(): SortOption[] {
  const byDate = {
    asc: m.workshop_sort_oldest_label(),
    desc: m.workshop_sort_newest_label(),
  };

  return [
    {
      field: "lastOpened",
      label: m.workshop_sort_recent_label(),
      icon: <ClockCounterClockwiseIcon weight="bold" className="h-4 w-4" />,
      initialDirection: "desc",
      directionLabels: byDate,
    },
    {
      field: "name",
      label: m.workshop_explorer_sort_name_label(),
      icon: <TextAaIcon weight="bold" className="h-4 w-4" />,
      initialDirection: "asc",
      directionLabels: {
        asc: m.workshop_sort_name_asc_label(),
        desc: m.workshop_sort_name_desc_label(),
      },
    },
    {
      field: "lastModified",
      label: m.workshop_sort_modified_label(),
      icon: <ClockIcon weight="bold" className="h-4 w-4" />,
      initialDirection: "desc",
      directionLabels: byDate,
    },
  ];
}

function reverse(direction: WorkshopSortDirection): WorkshopSortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** Which projects the grid lists by where they live. */
export function WorkshopLocationOptions() {
  const location = useWorkshopLocation();
  const setLocation = useSetWorkshopLocation();

  const options: { value: WorkshopLocationFilter; label: string }[] = [
    { value: "all", label: m.workshop_filter_location_all_label() },
    { value: "workshop", label: m.workshop_folder_workshop_label() },
    { value: "opened", label: m.workshop_filter_location_opened_label() },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <TogglePill
          key={option.value}
          label={option.label}
          active={location === option.value}
          onClick={() => setLocation(option.value)}
        />
      ))}
    </div>
  );
}

export function WorkshopSortOptions() {
  const sort = useWorkshopSort();
  const { setSort } = useWorkshopFilterActions();

  const selectOption = (option: SortOption) => {
    if (sort.field === option.field) {
      setSort({ field: option.field, direction: reverse(sort.direction) });
      return;
    }
    setSort({ field: option.field, direction: option.initialDirection });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {sortOptions().map((option) => (
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
  const sort = useWorkshopSort();
  const { setSort } = useWorkshopFilterActions();
  const option = sortOptions().find((o) => o.field === sort.field);

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
