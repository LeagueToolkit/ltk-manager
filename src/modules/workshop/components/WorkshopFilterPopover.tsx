import {
  ArrowsDownUpIcon,
  FunnelIcon,
  MapTrifoldIcon,
  TagIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import {
  Button,
  ChampionIcon,
  EmptyState,
  Field,
  FilterColumn,
  FilterOption,
  FilterSection,
  IconButton,
  Popover,
  Tooltip,
} from "@/components";
import {
  getMapIcon,
  getMapLabel,
  getTagIcon,
  getTagLabel,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "@/modules/library";
import { useHasActiveWorkshopFilters, useWorkshopFilterStore } from "@/stores";

import type { WorkshopFilterOptions } from "../api/useFilterOptions";
import { WorkshopSortDirectionToggle, WorkshopSortOptions } from "./WorkshopSortOptions";

function mergeUnique(wellKnown: string[], fromProjects: string[]): string[] {
  const seen = new Set(wellKnown);
  const result = [...wellKnown];
  for (const value of fromProjects) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

interface WorkshopFilterPopoverProps {
  filterOptions: WorkshopFilterOptions;
  /** Merged onto the trigger, so the caller can seat it inside a field. */
  className?: string;
}

export function WorkshopFilterPopover({ filterOptions, className }: WorkshopFilterPopoverProps) {
  const {
    selectedTags,
    selectedChampions,
    selectedMaps,
    toggleTag,
    toggleChampion,
    toggleMap,
    clearFilters,
  } = useWorkshopFilterStore();
  const hasActive = useHasActiveWorkshopFilters();
  const [champSearch, setChampSearch] = useState("");
  const hasChampions = filterOptions.champions.length > 0;

  const tags = useMemo(
    () => mergeUnique(WELL_KNOWN_TAGS, filterOptions.tags),
    [filterOptions.tags],
  );
  const maps = useMemo(
    () => mergeUnique(WELL_KNOWN_MAPS, filterOptions.maps),
    [filterOptions.maps],
  );

  const filteredChampions = useMemo(() => {
    if (!champSearch) return filterOptions.champions;
    const q = champSearch.toLowerCase();
    return filterOptions.champions.filter((c) => c.toLowerCase().includes(q));
  }, [filterOptions.champions, champSearch]);

  return (
    <Popover.Root>
      <Tooltip content="Sort and filter projects">
        <Popover.Trigger
          render={
            <IconButton
              icon={
                <div className="relative">
                  <FunnelIcon weight="bold" className="h-4 w-4" />
                  {hasActive && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent-500" />
                  )}
                </div>
              }
              variant="ghost"
              size="sm"
              aria-label="Sort and filter projects"
              className={className}
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          {/* A rung under the DS-GROUND default for floating UI, so it reads apart
              from the surface-800 toolbar it drops out of. */}
          <Popover.Popup
            aria-label="Sort and filter"
            className="w-[38rem] overflow-hidden bg-surface-900 p-0 select-none"
          >
            <div className="max-h-[min(32rem,70vh)] divide-y divide-surface-600/50 overflow-y-auto">
              <FilterSection
                title="Sort by"
                icon={<ArrowsDownUpIcon className="h-3.5 w-3.5" />}
                action={<WorkshopSortDirectionToggle />}
              >
                <WorkshopSortOptions />
              </FilterSection>

              <div className="flex divide-x divide-surface-600/50">
                {hasChampions && (
                  <FilterColumn
                    className="w-44 flex-none"
                    head={
                      <div className="relative flex items-center">
                        <ChampionIcon className="pointer-events-none absolute left-3 h-4 w-4 text-surface-400" />
                        <Field.Control
                          type="text"
                          placeholder="Search champions"
                          value={champSearch}
                          onChange={(e) => setChampSearch(e.target.value)}
                          className="h-8 rounded-none border-0 border-b border-surface-600/50 bg-surface-950/40 pr-3 pl-9 text-xs select-text hover:border-accent-hover focus:border-accent-500 focus:ring-0"
                        />
                      </div>
                    }
                  >
                    {filteredChampions.map((champ) => (
                      <FilterOption
                        key={champ}
                        label={champ}
                        checked={selectedChampions.has(champ)}
                        onToggle={() => toggleChampion(champ)}
                      />
                    ))}
                    {filteredChampions.length === 0 && (
                      <EmptyState size="xs" title="No champions found" />
                    )}
                  </FilterColumn>
                )}

                <FilterColumn title="Tags" icon={<TagIcon className="h-3.5 w-3.5" />}>
                  {tags.map((tag) => (
                    <FilterOption
                      key={tag}
                      label={getTagLabel(tag)}
                      icon={getTagIcon(tag)}
                      checked={selectedTags.has(tag)}
                      onToggle={() => toggleTag(tag)}
                    />
                  ))}
                </FilterColumn>

                <FilterColumn title="Maps" icon={<MapTrifoldIcon className="h-3.5 w-3.5" />}>
                  {maps.map((map) => (
                    <FilterOption
                      key={map}
                      label={getMapLabel(map)}
                      icon={getMapIcon(map)}
                      checked={selectedMaps.has(map)}
                      onToggle={() => toggleMap(map)}
                    />
                  ))}
                </FilterColumn>
              </div>
            </div>

            {hasActive && (
              <div className="flex justify-end border-t border-surface-600/50 px-3 py-2">
                <Button
                  variant="transparent"
                  size="sm"
                  compact
                  onClick={clearFilters}
                  left={<XIcon weight="bold" className="h-3.5 w-3.5" />}
                  className="font-normal"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
