import { Filter, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox, IconButton, Popover, Separator, Tooltip } from "@/components";
import type { FilterOptions } from "@/modules/library/api";
import {
  getMapLabel,
  getTagLabel,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "@/modules/library/utils/labels";
import { useHasActiveFilters, useLibraryFilterStore } from "@/stores";

function mergeUnique(wellKnown: string[], fromMods: string[]): string[] {
  const seen = new Set(wellKnown);
  const result = [...wellKnown];
  for (const value of fromMods) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

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
    showOnlyEnabled,
    setShowOnlyEnabled,
  } = useLibraryFilterStore();
  const hasActive = useHasActiveFilters();
  const [champSearch, setChampSearch] = useState("");

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
          <Popover.Popup className="w-80 p-4">
            <div className="mb-3 flex items-center justify-between">
              <Popover.Title className="text-sm font-semibold text-surface-100">
                Filters
              </Popover.Title>
              {hasActive && (
                <button
                  onClick={clearFilters}
                  className="flex cursor-pointer items-center gap-1 text-xs text-surface-400 hover:text-surface-200"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-1.5 pb-1">
                <Checkbox
                  size="sm"
                  label="Show only enabled"
                  checked={showOnlyEnabled}
                  onCheckedChange={setShowOnlyEnabled}
                />
              </div>

              <Separator />

              <FilterSection title="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <TogglePill
                      key={tag}
                      label={getTagLabel(tag)}
                      active={selectedTags.has(tag)}
                      onClick={() => toggleTag(tag)}
                    />
                  ))}
                </div>
              </FilterSection>

              <Separator />

              <FilterSection title="Maps">
                <div className="flex flex-wrap gap-1.5">
                  {maps.map((map) => (
                    <TogglePill
                      key={map}
                      label={getMapLabel(map)}
                      active={selectedMaps.has(map)}
                      onClick={() => toggleMap(map)}
                    />
                  ))}
                </div>
              </FilterSection>

              {filterOptions.champions.length > 0 && (
                <>
                  <Separator />
                  <FilterSection title="Champions">
                    {filterOptions.champions.length > 6 && (
                      <div className="relative mb-2">
                        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
                        <input
                          type="text"
                          placeholder="Search champions..."
                          value={champSearch}
                          onChange={(e) => setChampSearch(e.target.value)}
                          className="w-full rounded-md border border-surface-600 bg-surface-800 py-1.5 pr-3 pl-8 text-xs text-surface-100 placeholder:text-surface-500 focus-visible:border-accent-500 focus-visible:outline-none"
                        />
                      </div>
                    )}
                    <div className="max-h-[140px] overflow-y-auto">
                      <div className="flex flex-col gap-1.5">
                        {filteredChampions.map((champ) => (
                          <Checkbox
                            key={champ}
                            size="sm"
                            label={champ}
                            checked={selectedChampions.has(champ)}
                            onCheckedChange={() => toggleChampion(champ)}
                          />
                        ))}
                        {filteredChampions.length === 0 && (
                          <p className="py-1 text-xs text-surface-500">No champions found</p>
                        )}
                      </div>
                    </div>
                  </FilterSection>
                </>
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
      {children}
    </div>
  );
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-accent-500/50 bg-accent-500/20 text-accent-300 hover:bg-accent-500/30"
          : "border-surface-600 bg-surface-800 text-surface-400 hover:border-surface-500 hover:text-surface-200"
      }`}
    >
      {label}
    </button>
  );
}
