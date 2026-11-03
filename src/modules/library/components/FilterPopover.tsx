import {
  CalendarPlusIcon,
  ListNumbersIcon,
  TextAaIcon,
  ToggleRightIcon,
} from "@phosphor-icons/react";

import { ChampionIcon } from "@/components";
import { m } from "@/i18n";
import type { FilterOptions } from "@/modules/library/api";

import { type SortField, useHasActiveFilters, useLibraryFilterStore } from "../state";
import { FacetFilterPopover, type SortOption } from "./FacetFilterPopover";
import { LoadOrderNote } from "./LoadOrderNote";

function sortOptions(): SortOption<SortField>[] {
  const alphabetical = {
    asc: m.common_sort_name_asc_label(),
    desc: m.common_sort_name_desc_label(),
  };

  return [
    {
      field: "priority",
      label: m.library_sort_priority_label(),
      icon: <ListNumbersIcon weight="bold" className="size-4" />,
      initialDirection: "desc",
    },
    {
      field: "name",
      label: m.library_sort_name_label(),
      icon: <TextAaIcon weight="bold" className="size-4" />,
      initialDirection: "asc",
      directionLabels: alphabetical,
    },
    {
      field: "champion",
      label: m.library_sort_champion_label(),
      icon: <ChampionIcon className="size-4" />,
      initialDirection: "asc",
      directionLabels: alphabetical,
    },
    {
      field: "installedAt",
      label: m.library_sort_added_label(),
      icon: <CalendarPlusIcon weight="bold" className="size-4" />,
      initialDirection: "desc",
      directionLabels: { asc: m.common_sort_oldest_label(), desc: m.common_sort_newest_label() },
    },
    {
      field: "enabled",
      label: m.library_sort_enabled_label(),
      icon: <ToggleRightIcon weight="bold" className="size-4" />,
      initialDirection: "asc",
    },
  ];
}

interface FilterPopoverProps {
  filterOptions: FilterOptions;
}

/** How the library is sorted, and which mods it shows. */
export function FilterPopover({ filterOptions }: FilterPopoverProps) {
  const hasActive = useHasActiveFilters();

  return (
    <FacetFilterPopover
      store={useLibraryFilterStore}
      options={filterOptions}
      sortOptions={sortOptions()}
      hasActive={hasActive}
      triggerLabel={m.library_filter_trigger_label()}
      triggerSize="md"
      sortNote={<LoadOrderNote />}
    />
  );
}
