import { Crown, Grid3X3, List, Search } from "lucide-react";

import { IconButton, MultiSelect, Select, Switch, Tooltip } from "@/components";
import type { RuneforgeChampion, RuneforgeMap } from "@/lib/tauri";

import { type DownloadSiteId, downloadSites } from "../api/providers";

const SORT_OPTIONS = [
  { value: "recently_updated", label: "Recently updated" },
  { value: "recently_published", label: "Recently published" },
  { value: "trending", label: "Trending" },
  { value: "most_downloaded", label: "Most downloaded" },
  { value: "most_viewed", label: "Most viewed" },
  { value: "most_liked", label: "Most liked" },
];

interface DownloadToolbarProps {
  siteId: DownloadSiteId;
  onSiteChange: (siteId: DownloadSiteId) => void;
  search: string;
  onSearchChange: (search: string) => void;
  sortBy: string;
  onSortChange: (sortBy: string) => void;
  champions: RuneforgeChampion[];
  maps: RuneforgeMap[];
  selectedChampions: Set<string>;
  onChampionsChange: (selected: Set<string>) => void;
  selectedMaps: Set<string>;
  onMapsChange: (selected: Set<string>) => void;
  onlyGilded: boolean;
  onOnlyGildedChange: (value: boolean) => void;
  supportsMaps: boolean;
  supportsGilded: boolean;
  viewMode: "grid" | "list";
  onViewModeChange: (value: "grid" | "list") => void;
}

export function DownloadToolbar(props: DownloadToolbarProps) {
  return (
    <div className="border-b border-surface-600 bg-surface-800/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select.Root
          value={props.siteId}
          onValueChange={(value) => value && props.onSiteChange(value as DownloadSiteId)}
        >
          <Select.Trigger className="w-40">
            <Select.Value prefix="Site:">
              {(value: string) =>
                downloadSites.find((site) => site.id === value)?.label ?? "Select site"
              }
            </Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup>
                {downloadSites.map((site) => (
                  <Select.Item key={site.id} value={site.id}>
                    {site.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>

        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search downloadable mods..."
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-surface-600 bg-surface-800 pr-4 pl-10 text-sm text-surface-100 placeholder:text-surface-500 focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none"
          />
        </div>

        <MultiSelect
          label="Champions"
          options={props.champions.map((champion) => ({
            value: champion.name,
            label: champion.name,
          }))}
          selected={props.selectedChampions}
          onChange={props.onChampionsChange}
          placeholder="Search champions..."
        />
        {props.supportsMaps && (
          <MultiSelect
            label="Maps"
            options={props.maps.map((map) => ({ value: String(map.id), label: map.name }))}
            selected={props.selectedMaps}
            onChange={props.onMapsChange}
            placeholder="Search maps..."
          />
        )}

        <Select.Root
          value={props.sortBy}
          onValueChange={(value) => value && props.onSortChange(value)}
        >
          <Select.Trigger className="w-48 text-xs">
            <Select.Value prefix="Sort by:">
              {(value: string) =>
                SORT_OPTIONS.find((option) => option.value === value)?.label ?? "Sort"
              }
            </Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup>
                {SORT_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>

        {props.supportsGilded && (
          <label className="flex h-8 items-center gap-2 text-xs text-surface-300">
            <Crown className="h-3.5 w-3.5 text-amber-400" />
            Gilded only
            <Switch
              size="sm"
              checked={props.onlyGilded}
              onCheckedChange={props.onOnlyGildedChange}
            />
          </label>
        )}

        <div className="flex items-center gap-1">
          <Tooltip content="Grid view">
            <IconButton
              icon={<Grid3X3 className="h-4 w-4" />}
              variant={props.viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => props.onViewModeChange("grid")}
              aria-label="Grid view"
            />
          </Tooltip>
          <Tooltip content="List view">
            <IconButton
              icon={<List className="h-4 w-4" />}
              variant={props.viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => props.onViewModeChange("list")}
              aria-label="List view"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
