import { X } from "lucide-react";
import { useMemo } from "react";

import { MultiSelect, type MultiSelectOption } from "@/components";
import { getMapLabel, getTagLabel, WELL_KNOWN_MAPS, WELL_KNOWN_TAGS } from "@/modules/library";
import { useHasActiveWorkshopFilters, useWorkshopFilterStore } from "@/stores";

import type { WorkshopFilterOptions } from "../api/useFilterOptions";

function mergeOptions(
  wellKnown: string[],
  fromProjects: string[],
  getLabel: (value: string) => string,
): MultiSelectOption[] {
  const seen = new Set<string>();
  const options: MultiSelectOption[] = [];
  for (const value of wellKnown) {
    seen.add(value);
    options.push({ value, label: getLabel(value) });
  }
  for (const value of fromProjects) {
    if (!seen.has(value)) {
      options.push({ value, label: getLabel(value) });
    }
  }
  return options;
}

interface WorkshopFilterBarProps {
  filterOptions: WorkshopFilterOptions;
}

export function WorkshopFilterBar({ filterOptions }: WorkshopFilterBarProps) {
  const {
    selectedTags,
    selectedChampions,
    selectedMaps,
    setTags,
    setChampions,
    setMaps,
    clearFilters,
  } = useWorkshopFilterStore();
  const hasActive = useHasActiveWorkshopFilters();

  const tagOptions = useMemo(
    () => mergeOptions(WELL_KNOWN_TAGS, filterOptions.tags, getTagLabel),
    [filterOptions.tags],
  );
  const championOptions = useMemo(
    () => filterOptions.champions.map((c) => ({ value: c, label: c })),
    [filterOptions.champions],
  );
  const mapOptions = useMemo(
    () => mergeOptions(WELL_KNOWN_MAPS, filterOptions.maps, getMapLabel),
    [filterOptions.maps],
  );

  return (
    <div className="flex items-center gap-3 border-b border-surface-700 bg-surface-800/30 px-4 py-2">
      <MultiSelect
        label="Tags"
        options={tagOptions}
        selected={selectedTags}
        onChange={setTags}
        placeholder="Search tags..."
      />
      <MultiSelect
        label="Champions"
        options={championOptions}
        selected={selectedChampions}
        onChange={setChampions}
        placeholder="Search champions..."
      />
      <MultiSelect
        label="Maps"
        options={mapOptions}
        selected={selectedMaps}
        onChange={setMaps}
        placeholder="Search maps..."
      />
      {hasActive && (
        <button
          onClick={clearFilters}
          className="flex shrink-0 items-center gap-1 text-xs text-surface-400 hover:text-surface-200"
        >
          <X className="h-3 w-3" />
          Clear all
        </button>
      )}
    </div>
  );
}
