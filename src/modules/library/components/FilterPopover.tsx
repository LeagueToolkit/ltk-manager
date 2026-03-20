import { Filter, X } from "lucide-react";

import { Checkbox, IconButton, Popover, Tooltip } from "@/components";
import type { FilterOptions } from "@/modules/library/api";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { useHasActiveFilters, useLibraryFilterStore } from "@/stores";

interface FilterPopoverProps {
  filterOptions: FilterOptions;
}

export function FilterPopover({ filterOptions }: FilterPopoverProps) {
  const {
    selectedTags,
    selectedChampions,
    selectedMaps,
    toggleTag,
    toggleChampion,
    toggleMap,
    clearFilters,
  } = useLibraryFilterStore();
  const hasActive = useHasActiveFilters();

  const hasOptions =
    filterOptions.tags.length > 0 ||
    filterOptions.champions.length > 0 ||
    filterOptions.maps.length > 0;

  if (!hasOptions) return null;

  return (
    <Popover.Root>
      <Tooltip content="Filter mods">
        <Popover.Trigger
          render={
            <IconButton
              icon={
                <div className="relative">
                  <Filter className="h-4 w-4" />
                  {hasActive && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent-500" />
                  )}
                </div>
              }
              variant="ghost"
              size="sm"
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="w-64 p-3">
            <div className="mb-3 flex items-center justify-between">
              <Popover.Title>Filters</Popover.Title>
              {hasActive && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="space-y-4">
              {filterOptions.tags.length > 0 && (
                <FilterSection title="Tags">
                  {filterOptions.tags.map((tag) => (
                    <Checkbox
                      key={tag}
                      size="sm"
                      label={getTagLabel(tag)}
                      checked={selectedTags.has(tag)}
                      onCheckedChange={() => toggleTag(tag)}
                    />
                  ))}
                </FilterSection>
              )}

              {filterOptions.champions.length > 0 && (
                <FilterSection title="Champions">
                  {filterOptions.champions.map((champ) => (
                    <Checkbox
                      key={champ}
                      size="sm"
                      label={champ}
                      checked={selectedChampions.has(champ)}
                      onCheckedChange={() => toggleChampion(champ)}
                    />
                  ))}
                </FilterSection>
              )}

              {filterOptions.maps.length > 0 && (
                <FilterSection title="Maps">
                  {filterOptions.maps.map((map) => (
                    <Checkbox
                      key={map}
                      size="sm"
                      label={getMapLabel(map)}
                      checked={selectedMaps.has(map)}
                      onCheckedChange={() => toggleMap(map)}
                    />
                  ))}
                </FilterSection>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium tracking-wide text-surface-500 uppercase">{title}</h4>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
