import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type DownloadMod, type DownloadRelease } from "@/lib/tauri";
import { useDeepLinkStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { type DownloadQuery, type DownloadSiteId, getDownloadSite } from "./providers";

export type DownloadFilters = Omit<DownloadQuery, "page">;

export const downloadKeys = {
  all: ["downloads"] as const,
  champions: () => [...downloadKeys.all, "runeforge", "champions"] as const,
  maps: () => [...downloadKeys.all, "runeforge", "maps"] as const,
  mods: (siteId: DownloadSiteId, query: DownloadFilters) =>
    [...downloadKeys.all, siteId, "mods", query] as const,
  media: (siteId: DownloadSiteId, modId: string) =>
    [...downloadKeys.all, siteId, "media", modId] as const,
  releases: (siteId: DownloadSiteId, modId: string) =>
    [...downloadKeys.all, siteId, "releases", modId] as const,
};

export function useDownloadCatalogs() {
  const champions = useQuery({
    queryKey: downloadKeys.champions(),
    queryFn: async () => unwrapForQuery(await api.getRuneforgeChampions()),
    staleTime: 1000 * 60 * 60,
  });
  const maps = useQuery({
    queryKey: downloadKeys.maps(),
    queryFn: async () => unwrapForQuery(await api.getRuneforgeMaps()),
    staleTime: 1000 * 60 * 60,
  });
  return { champions, maps };
}

export function useDownloadMods(siteId: DownloadSiteId, query: DownloadFilters) {
  const site = getDownloadSite(siteId);
  return useInfiniteQuery({
    queryKey: downloadKeys.mods(siteId, query),
    queryFn: ({ pageParam }) => site.fetchMods({ ...query, page: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.mods.length === 0) return undefined;
      const loadedCount = pages.reduce((total, page) => total + page.mods.length, 0);
      return loadedCount < lastPage.total ? pages.length : undefined;
    },
  });
}

export function useDownloadReleases(siteId: DownloadSiteId, modId: string, enabled: boolean) {
  const site = getDownloadSite(siteId);
  return useQuery({
    queryKey: downloadKeys.releases(siteId, modId),
    queryFn: () => site.fetchReleases(modId),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
}

export function useDownloadMedia(siteId: DownloadSiteId, modId: string, enabled: boolean) {
  const site = getDownloadSite(siteId);
  return useQuery({
    queryKey: downloadKeys.media(siteId, modId),
    queryFn: () => site.fetchMedia(modId),
    enabled,
    staleTime: 1000 * 60 * 30,
  });
}

export interface DownloadInstallSelection {
  mod: DownloadMod;
  release?: DownloadRelease;
}

export function useInstallLatestDownload(siteId: DownloadSiteId) {
  const site = getDownloadSite(siteId);
  const queryClient = useQueryClient();
  return useMutation<DownloadRelease, AppError, DownloadInstallSelection>({
    mutationFn: async ({ mod, release }) => {
      const selected =
        release ??
        (
          await queryClient.ensureQueryData({
            queryKey: downloadKeys.releases(siteId, mod.id),
            queryFn: () => site.fetchReleases(mod.id),
            staleTime: 1000 * 60 * 5,
          })
        )[0];
      if (!selected) {
        throw { code: "UNKNOWN", message: "This mod has no downloadable release." } as AppError;
      }
      return site.resolveRelease(mod, selected);
    },
    onSuccess: (release, { mod }) => {
      useDeepLinkStore.getState().setRequest({
        url: release.downloadUrl,
        name: mod.name,
        author: mod.publisher.username,
        source: site.sourceLabel,
      });
    },
  });
}
