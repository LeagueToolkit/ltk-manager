import {
  ArrowDownIcon,
  ArrowsDownUpIcon,
  ArrowUpIcon,
  FunnelIcon,
  MapTrifoldIcon,
  TagIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo, useState } from "react";
import { type StoreApi, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

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
  TogglePill,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import {
  type ChampionOption,
  championOptions,
  ChampionPortrait,
  useChampionRoster,
} from "@/modules/champions";
import {
  facetFilterActions,
  type FacetFilterState,
  type SortConfig,
  type SortDirection,
} from "@/stores/facetFilter";

import {
  getMapIcon,
  getMapLabel,
  getTagIcon,
  getTagLabel,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "../utils";

/**
 * A facet filter store, read through `useStore`. Both the library's and the workshop's fit it.
 *
 * The store rather than its hook, because the React Compiler memoizes a call it does not see as a
 * hook, and a hook passed in a prop is not named like one.
 */
export type FacetStore<F extends string> = Pick<
  StoreApi<FacetFilterState<F>>,
  "getState" | "getInitialState" | "subscribe"
>;

/** One field a list sorts by, as a pill of the sort section. */
export interface SortOption<F extends string> {
  field: F;
  label: string;
  icon: ReactNode;
  initialDirection: SortDirection;
  /** Set only on the fields the reader can reverse, keyed by what each direction means. */
  directionLabels?: Record<SortDirection, string>;
}

/** The facets a list's items carry, which the columns offer beside the well-known ones. */
export interface FacetOptions {
  tags: string[];
  champions: string[];
  maps: string[];
}

export interface FacetFilterPopoverProps<F extends string> {
  store: FacetStore<F>;
  options: FacetOptions;
  sortOptions: readonly SortOption<F>[];
  /** A filter is set, which the trigger marks and the clear answers to. */
  hasActive: boolean;
  triggerLabel: string;
  /** The trigger's size, `xs` unless the caller seats it in a taller bar. */
  triggerSize?: "xs" | "md";
  onOpenChange?: (open: boolean) => void;
  /** A line under the sort pills, for what the active sort does beyond the view. */
  sortNote?: ReactNode;
  /** Sections between the sort and the facet columns. */
  children?: ReactNode;
}

/** How a list of mods or projects is sorted, and which of them it shows by tag, champion and map. */
export function FacetFilterPopover<F extends string>({
  store,
  options,
  sortOptions,
  hasActive,
  triggerLabel,
  triggerSize = "xs",
  onOpenChange,
  sortNote,
  children,
}: FacetFilterPopoverProps<F>) {
  const selectedTags = useStore(store, (s) => s.selectedTags);
  const selectedChampions = useStore(store, (s) => s.selectedChampions);
  const selectedMaps = useStore(store, (s) => s.selectedMaps);
  const sort = useStore(store, (s) => s.sort);
  const { toggleTag, toggleChampion, toggleMap, setChampions, clearFilters, setSort } = useStore(
    store,
    useShallow(facetFilterActions<F>),
  );
  const roster = useChampionRoster();
  const [champSearch, setChampSearch] = useState("");

  const tags = useMemo(() => mergeUnique(WELL_KNOWN_TAGS, options.tags), [options.tags]);
  const maps = useMemo(() => mergeUnique(WELL_KNOWN_MAPS, options.maps), [options.maps]);

  const champions = useMemo(
    () => championOptions(roster, options.champions),
    [roster, options.champions],
  );
  const hasChampions = champions.length > 0;

  const filteredChampions = useMemo(() => {
    if (!champSearch) return champions;

    const q = champSearch.toLowerCase();
    return champions.filter((option) => option.search.includes(q));
  }, [champions, champSearch]);

  const selectedChampionKeys = useMemo(
    () => new Set([...selectedChampions].map(roster.keyOf)),
    [selectedChampions, roster],
  );

  /* A row stands for every value naming its champion, so unchecking it drops them all. */
  const toggleChampionOption = (option: ChampionOption) => {
    if (!selectedChampionKeys.has(option.key)) {
      toggleChampion(option.value);
      return;
    }

    setChampions(
      new Set([...selectedChampions].filter((value) => roster.keyOf(value) !== option.key)),
    );
  };

  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Tooltip content={triggerLabel}>
        <Popover.Trigger
          render={
            <IconButton
              size={triggerSize}
              icon={
                <div className="relative">
                  <FunnelIcon />
                  {hasActive && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-accent-500" />
                  )}
                </div>
              }
              aria-label={triggerLabel}
            />
          }
        />
      </Tooltip>
      <Popover.Content
        side="bottom"
        align="end"
        sideOffset={8}
        aria-label={m.common_filter_popup_label()}
        className="w-[38rem] overflow-hidden p-0 select-none"
      >
        <div className="max-h-[min(32rem,70vh)] divide-y divide-surface-600/50 overflow-y-auto">
          <FilterSection
            title={m.common_sort_section_label()}
            icon={<ArrowsDownUpIcon className="size-3.5" />}
            action={<SortDirectionToggle options={sortOptions} sort={sort} onSort={setSort} />}
          >
            <SortOptions options={sortOptions} sort={sort} onSort={setSort} />
            {sortNote}
          </FilterSection>

          {children}

          <div className="flex divide-x divide-surface-600/50">
            {hasChampions && (
              <FilterColumn
                className="w-44 flex-none"
                head={
                  <div className="relative flex items-center">
                    <ChampionIcon className="pointer-events-none absolute left-3 size-4 text-surface-400" />
                    <Field.Control
                      type="text"
                      placeholder={m.common_filter_champion_search_placeholder()}
                      value={champSearch}
                      onChange={(e) => setChampSearch(e.target.value)}
                      className="h-8 rounded-none border-0 border-b border-surface-600/50 bg-surface-950/40 pr-3 pl-9 text-xs select-text hover:border-accent-hover focus:border-accent-500 focus:ring-0"
                    />
                  </div>
                }
              >
                {filteredChampions.map((option) => (
                  <FilterOption
                    key={option.key}
                    label={option.label}
                    icon={<ChampionPortrait champion={option.champion} className="size-4" />}
                    checked={selectedChampionKeys.has(option.key)}
                    onToggle={() => toggleChampionOption(option)}
                  />
                ))}
                {filteredChampions.length === 0 && (
                  <EmptyState size="xs" title={m.common_filter_champion_empty()} />
                )}
              </FilterColumn>
            )}

            <FilterColumn
              title={m.common_filter_tags_label()}
              icon={<TagIcon className="size-3.5" />}
            >
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

            <FilterColumn
              title={m.common_filter_maps_label()}
              icon={<MapTrifoldIcon className="size-3.5" />}
            >
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
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              left={<XIcon weight="bold" className="size-3.5" />}
              className="font-normal"
            >
              {m.common_filter_clear_action()}
            </Button>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

interface SortControlProps<F extends string> {
  options: readonly SortOption<F>[];
  sort: SortConfig<F>;
  onSort: (sort: SortConfig<F>) => void;
}

function reverse(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** The sort fields as pills. A second press on the active one reverses it, where it reverses. */
function SortOptions<F extends string>({ options, sort, onSort }: SortControlProps<F>) {
  const selectOption = (option: SortOption<F>) => {
    if (sort.field === option.field && option.directionLabels) {
      onSort({ field: option.field, direction: reverse(sort.direction) });
      return;
    }
    onSort({ field: option.field, direction: option.initialDirection });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
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
function SortDirectionToggle<F extends string>({ options, sort, onSort }: SortControlProps<F>) {
  const option = options.find((each) => each.field === sort.field);
  if (!option?.directionLabels) return null;

  const icon = sort.direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />;

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => onSort({ field: sort.field, direction: reverse(sort.direction) })}
      right={icon}
      className="font-normal text-accent-300 hover:bg-accent-500/15 hover:text-accent-200"
    >
      {option.directionLabels[sort.direction]}
    </Button>
  );
}

function mergeUnique(wellKnown: string[], fromItems: string[]): string[] {
  const seen = new Set(wellKnown);
  const result = [...wellKnown];
  for (const value of fromItems) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
