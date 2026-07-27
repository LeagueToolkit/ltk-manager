import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button, useToast } from "@/components";
import type { DownloadMod, DownloadRelease } from "@/lib/tauri";
import {
  DownloadEmptyState,
  DownloadErrorState,
  DownloadLoadingState,
  DownloadModCard,
  type DownloadSiteId,
  DownloadToolbar,
  getDownloadSite,
  useDownloadCatalogs,
  useDownloadMods,
  useInstallLatestDownload,
} from "@/modules/downloads";

const PAGE_SIZE = 24;
const GRID_MIN_WIDTH = 240;
const GRID_MAX_WIDTH = 320;
const GRID_GAP = 16;
const GRID_CARD_BODY_HEIGHT = 158;
const LIST_ROW_SIZE = 88;
const EMPTY_IMAGE_URLS: string[] = [];

export function Downloads() {
  const [siteId, setSiteId] = useState<DownloadSiteId>("runeforge");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortBy, setSortBy] = useState("recently_updated");
  const [selectedChampions, setSelectedChampions] = useState<Set<string>>(new Set());
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(new Set());
  const [onlyGilded, setOnlyGilded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [catalogWidth, setCatalogWidth] = useState(960);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const site = getDownloadSite(siteId);
  const catalogs = useDownloadCatalogs();
  const query = {
    pageSize: PAGE_SIZE,
    search: deferredSearch,
    sortBy,
    championIds: (catalogs.champions.data?.champions ?? [])
      .filter((champion) => selectedChampions.has(champion.name))
      .map((champion) => champion.id),
    championNames: [...selectedChampions],
    mapIds: [...selectedMaps].map(Number),
    onlyGilded,
  };
  const modsQuery = useDownloadMods(siteId, query);
  const installLatest = useInstallLatestDownload(siteId);
  const mods = useMemo(
    () => [
      ...new Map(
        (modsQuery.data?.pages.flatMap((page) => page.mods) ?? []).map((mod) => [mod.id, mod]),
      ).values(),
    ],
    [modsQuery.data],
  );
  const total = modsQuery.data?.pages[0]?.total ?? 0;
  const columnCount =
    viewMode === "grid"
      ? Math.max(1, Math.floor((catalogWidth + GRID_GAP) / (GRID_MIN_WIDTH + GRID_GAP)))
      : 1;
  const gridTrackWidth = Math.min(
    GRID_MAX_WIDTH,
    Math.max(GRID_MIN_WIDTH, (catalogWidth - GRID_GAP * (columnCount - 1)) / columnCount),
  );
  const gridCardHeight = Math.ceil((gridTrackWidth * 9) / 16) + GRID_CARD_BODY_HEIGHT;
  const gridRowSize = gridCardHeight + GRID_GAP;
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(mods.length / columnCount) }, (_, index) =>
        mods.slice(index * columnCount, (index + 1) * columnCount),
      ),
    [columnCount, mods],
  );
  const thumbnailUrlsById = useMemo(
    () => new Map(mods.map((mod) => [mod.id, site.thumbnailUrls(mod)])),
    [mods, site],
  );
  const installMod = installLatest.mutate;
  const handleInstall = useCallback(
    (selectedMod: DownloadMod, release?: DownloadRelease) => {
      installMod(
        { mod: selectedMod, release },
        {
          onError: (error) => toast.error("Could not prepare download", error.message),
        },
      );
    },
    [installMod, toast],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length + (modsQuery.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      if (index >= rows.length) return 48;
      return viewMode === "grid" ? gridRowSize : LIST_ROW_SIZE;
    },
    getItemKey: (index) => rows[index]?.map((mod) => mod.id).join(":") ?? "loading-more",
    overscan: 3,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows.at(-1)?.index;
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = modsQuery;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateWidth = () => setCatalogWidth(Math.max(0, element.clientWidth - 48));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [deferredSearch, onlyGilded, selectedChampions, selectedMaps, siteId, sortBy, viewMode]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnCount, rowVirtualizer, viewMode]);

  useEffect(() => {
    if (
      lastVirtualIndex === undefined ||
      lastVirtualIndex < rows.length - 2 ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }
    void fetchNextPage();
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    lastVirtualIndex,
    rows.length,
  ]);

  return (
    <div className="flex h-full flex-col">
      <DownloadToolbar
        siteId={siteId}
        onSiteChange={(nextSiteId) => {
          const nextSite = getDownloadSite(nextSiteId);
          setSiteId(nextSiteId);
          if (!nextSite.supportsMaps) setSelectedMaps(new Set());
          if (!nextSite.supportsGilded) setOnlyGilded(false);
          if (
            nextSite.maxChampionSelections &&
            selectedChampions.size > nextSite.maxChampionSelections
          ) {
            setSelectedChampions(
              new Set([...selectedChampions].slice(0, nextSite.maxChampionSelections)),
            );
          }
        }}
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortChange={setSortBy}
        champions={catalogs.champions.data?.champions ?? []}
        maps={catalogs.maps.data?.maps ?? []}
        selectedChampions={selectedChampions}
        onChampionsChange={(selected) => {
          if (!site.maxChampionSelections || selected.size <= site.maxChampionSelections) {
            setSelectedChampions(selected);
            return;
          }
          const newlySelected = [...selected].find((name) => !selectedChampions.has(name));
          setSelectedChampions(new Set(newlySelected ? [newlySelected] : [...selected].slice(-1)));
        }}
        selectedMaps={selectedMaps}
        onMapsChange={setSelectedMaps}
        onlyGilded={onlyGilded}
        onOnlyGildedChange={setOnlyGilded}
        supportsMaps={site.supportsMaps}
        supportsGilded={site.supportsGilded}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <div ref={scrollRef} className="flex-1 overflow-auto p-6">
        {modsQuery.isLoading ? (
          <DownloadLoadingState />
        ) : modsQuery.error && !mods.length ? (
          <DownloadErrorState
            message={modsQuery.error.message}
            onRetry={() => modsQuery.refetch()}
          />
        ) : !mods.length ? (
          <DownloadEmptyState />
        ) : (
          <>
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) {
                  return (
                    <div
                      key={virtualRow.key}
                      className="absolute top-0 left-0 flex h-12 w-full items-center justify-center"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {modsQuery.isFetchNextPageError ? (
                        <Button variant="ghost" size="xs" onClick={() => modsQuery.fetchNextPage()}>
                          Could not load more. Retry
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs text-surface-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading more mods
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={virtualRow.key}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div
                      className={
                        viewMode === "grid"
                          ? "grid justify-center gap-4 pb-4"
                          : "flex flex-col gap-2 pb-2"
                      }
                      style={
                        viewMode === "grid"
                          ? {
                              gridTemplateColumns: `repeat(${columnCount}, minmax(0, ${GRID_MAX_WIDTH}px))`,
                              gridAutoRows: `${gridCardHeight}px`,
                            }
                          : undefined
                      }
                    >
                      {row.map((mod) => (
                        <DownloadModCard
                          key={`${siteId}:${mod.id}`}
                          siteId={siteId}
                          mod={mod}
                          thumbnailUrls={thumbnailUrlsById.get(mod.id) ?? EMPTY_IMAGE_URLS}
                          viewMode={viewMode}
                          installing={
                            installLatest.isPending && installLatest.variables?.mod.id === mod.id
                          }
                          onInstall={handleInstall}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {!modsQuery.hasNextPage && (
              <div className="pt-2 text-center text-xs text-surface-500">
                {mods.length.toLocaleString()} of {total.toLocaleString()} mods loaded
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
