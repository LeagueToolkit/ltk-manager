import {
  api,
  type DownloadMedia,
  type DownloadMod,
  type DownloadModsResponse,
  type DownloadRelease,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

export type DownloadSiteId = "runeforge" | "divineskins";

export interface DownloadQuery {
  page: number;
  pageSize: number;
  search: string;
  sortBy: string;
  championIds: number[];
  championNames: string[];
  mapIds: number[];
  onlyGilded: boolean;
}

export interface DownloadSite {
  id: DownloadSiteId;
  label: string;
  sourceLabel: string;
  supportsMaps: boolean;
  supportsGilded: boolean;
  maxChampionSelections: number | null;
  fetchMods: (query: DownloadQuery) => Promise<DownloadModsResponse>;
  fetchMedia: (modId: string) => Promise<DownloadMedia>;
  fetchReleases: (modId: string) => Promise<DownloadRelease[]>;
  resolveRelease: (mod: DownloadMod, release: DownloadRelease) => Promise<DownloadRelease>;
  thumbnailUrls: (mod: DownloadMod) => string[];
  mediaImageUrls: (url: string) => string[];
}

export const downloadSites: DownloadSite[] = [
  {
    id: "runeforge",
    label: "RuneForge",
    sourceLabel: "RuneForge",
    supportsMaps: true,
    supportsGilded: true,
    maxChampionSelections: null,
    fetchMods: async (query) =>
      unwrapForQuery(
        await api.getRuneforgeMods({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          sortBy: query.sortBy,
          championIds: query.championIds,
          mapIds: query.mapIds,
          onlyGilded: query.onlyGilded,
        }),
      ),
    fetchMedia: async (modId) => unwrapForQuery(await api.getRuneforgeMedia(modId)),
    fetchReleases: async (modId) => unwrapForQuery(await api.getRuneforgeReleases(modId)),
    resolveRelease: async (_mod, release) => release,
    thumbnailUrls: (mod) => [
      ...runeforgeThumbnailUrls(mod.thumbnailKey),
      ...runeforgeFallbackImageUrls(mod.fallbackImageUrl),
    ],
    mediaImageUrls: runeforgeFallbackImageUrls,
  },
  {
    id: "divineskins",
    label: "DivineSkins",
    sourceLabel: "DivineSkins",
    supportsMaps: false,
    supportsGilded: false,
    maxChampionSelections: 1,
    fetchMods: async (query) =>
      unwrapForQuery(
        await api.getDivineskinsMods({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          sortBy: query.sortBy,
          championNames: query.championNames,
        }),
      ),
    fetchMedia: async (modId) => unwrapForQuery(await api.getDivineskinsMedia(modId)),
    fetchReleases: async (modId) => unwrapForQuery(await api.getDivineskinsReleases(modId)),
    resolveRelease: async (mod, release) => ({
      ...release,
      downloadUrl: unwrapForQuery(await api.getDivineskinsDownloadUrl(mod.id, release.id)),
    }),
    thumbnailUrls: (mod) => divineskinsImageUrls(mod.thumbnailKey),
    mediaImageUrls: divineskinsImageUrls,
  },
];

export function runeforgeThumbnailUrls(thumbnailKey: string | null): string[] {
  if (!thumbnailKey) return [];

  const encodedKey = encodeURIComponent(thumbnailKey);
  const original = `https://r2-images-prod.runeforge.dev/${encodedKey}`;
  return [
    `https://runeforge.dev/cdn-cgi/image/width=600,height=400,quality=85,format=webp,fit=contain,anim=false/${original}`,
    original,
  ];
}

export function runeforgeFallbackImageUrls(imageUrl: string | null): string[] {
  if (!imageUrl) return [];

  try {
    const parsedUrl = new URL(imageUrl, "https://runeforge.dev");
    if (!["runeforge.dev", "r2-images-prod.runeforge.dev"].includes(parsedUrl.hostname)) return [];
    const urls = [parsedUrl.toString()];
    const r2Marker = "https://r2-images-prod.runeforge.dev/";
    const nestedR2Index = parsedUrl.toString().indexOf(r2Marker);
    if (nestedR2Index >= 0) urls.push(parsedUrl.toString().slice(nestedR2Index));
    return [...new Set(urls)];
  } catch {
    return [];
  }
}

export function divineskinsImageUrls(imageKeyOrUrl: string | null): string[] {
  if (!imageKeyOrUrl) return [];

  try {
    const parsedUrl = new URL(imageKeyOrUrl);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "lol-assets.divine-cdn.com"
      ? [parsedUrl.toString()]
      : [];
  } catch {
    const segments = imageKeyOrUrl
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .map(encodeURIComponent);
    return segments.length ? [`https://lol-assets.divine-cdn.com/${segments.join("/")}`] : [];
  }
}

export function youtubeThumbnailUrls(videoUrl: string | null): string[] {
  if (!videoUrl) return [];

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    return [];
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    videoId = parsedUrl.searchParams.get("v");
    if (!videoId) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) videoId = parts[1] ?? null;
    }
  }

  if (!videoId || !/^[\w-]{6,}$/.test(videoId)) return [];

  const encodedId = encodeURIComponent(videoId);
  return [
    `https://i.ytimg.com/vi/${encodedId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${encodedId}/hqdefault.jpg`,
  ];
}

export const runeforgeVideoThumbnailUrls = youtubeThumbnailUrls;

export function getDownloadSite(id: DownloadSiteId): DownloadSite {
  return downloadSites.find((site) => site.id === id) ?? downloadSites[0];
}
