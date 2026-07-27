import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  Eye,
  Heart,
  ImageOff,
  Loader2,
  Play,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Menu, Tooltip } from "@/components";
import { api, type DownloadMod, type DownloadRelease } from "@/lib/tauri";

import { useDownloadMedia, useDownloadReleases } from "../api/hooks";
import { type DownloadSiteId, getDownloadSite, youtubeThumbnailUrls } from "../api/providers";

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function ModBadges({ mod }: { mod: DownloadMod }) {
  const badges = [
    ...mod.champions.map((champion) => ({ key: `champion-${champion.id}`, label: champion.name })),
    ...mod.maps.map((map) => ({ key: `map-${map.id}`, label: map.name })),
    ...mod.themes.map((theme) => ({ key: `theme-${theme}`, label: theme })),
  ].slice(0, 3);

  return (
    <div className="flex h-5 flex-nowrap items-center gap-1 overflow-hidden">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className="shrink-0 rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-300"
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

interface DownloadModCardProps {
  siteId: DownloadSiteId;
  mod: DownloadMod;
  thumbnailUrls: string[];
  viewMode: "grid" | "list";
  installing: boolean;
  onInstall: (mod: DownloadMod, release?: DownloadRelease) => void;
}

export const DownloadModCard = memo(function DownloadModCard({
  siteId,
  mod,
  thumbnailUrls,
  viewMode,
  installing,
  onInstall,
}: DownloadModCardProps) {
  if (viewMode === "list") {
    return (
      <div className="flex min-h-20 items-center gap-4 rounded-lg border border-surface-700 bg-surface-900 p-3 transition-colors hover:border-surface-500 hover:bg-surface-800/80">
        <DownloadThumbnail
          modId={mod.id}
          siteId={siteId}
          modName={mod.name}
          urls={thumbnailUrls}
          videoUrl={mod.videoUrl}
          variant="list"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-medium text-surface-100">{mod.name}</h3>
            {mod.isGilded && (
              <Tooltip content="RuneForge Gilded mod">
                <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              </Tooltip>
            )}
          </div>
          <p className="truncate text-xs text-surface-500">by {mod.publisher.username}</p>
          <ModBadges mod={mod} />
        </div>
        <ModStats mod={mod} />
        <InstallModControl
          siteId={siteId}
          mod={mod}
          size="sm"
          installing={installing}
          onInstall={onInstall}
        />
      </div>
    );
  }

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-lg border border-surface-600 bg-surface-800 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-surface-400 hover:shadow-md">
      <div className="relative aspect-video overflow-hidden bg-surface-700">
        <DownloadThumbnail
          modId={mod.id}
          siteId={siteId}
          modName={mod.name}
          urls={thumbnailUrls}
          videoUrl={mod.videoUrl}
          variant="grid"
        />
        {mod.isGilded && (
          <Tooltip content="RuneForge Gilded mod">
            <span className="absolute top-2 right-2 rounded-md bg-surface-950/85 p-1.5 text-amber-400 shadow-md">
              <Crown className="h-4 w-4" />
            </span>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-1 text-sm font-medium text-surface-100">{mod.name}</h3>
        <p className="mb-2 truncate text-xs text-surface-500">by {mod.publisher.username}</p>
        <ModBadges mod={mod} />
        <div className="mt-auto flex flex-col gap-2 pt-3">
          <ModStats mod={mod} />
          <div className="flex justify-end">
            <InstallModControl
              siteId={siteId}
              mod={mod}
              size="xs"
              installing={installing}
              onInstall={onInstall}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

function DownloadThumbnail({
  siteId,
  modId,
  modName,
  urls,
  videoUrl,
  variant,
}: {
  siteId: DownloadSiteId;
  modId: string;
  modName: string;
  urls: string[];
  videoUrl: string | null;
  variant: "grid" | "list";
}) {
  const site = getDownloadSite(siteId);
  const [mediaRequested, setMediaRequested] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const mediaRequestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const media = useDownloadMedia(siteId, modId, mediaRequested);
  const resolvedVideoUrl = media.data?.videoUrl ?? videoUrl;
  const galleryUrls = (media.data?.images ?? []).filter((url) => !urls.includes(url));
  const slides: MediaSlide[] = [
    ...(urls.length ? [{ key: "thumbnail", urls, videoUrl: null }] : []),
    ...galleryUrls.map((url) => ({
      key: url,
      urls: site.mediaImageUrls(url),
      videoUrl: null,
    })),
    ...(resolvedVideoUrl
      ? [
          {
            key: `video-${resolvedVideoUrl}`,
            urls: youtubeThumbnailUrls(resolvedVideoUrl),
            videoUrl: resolvedVideoUrl,
          },
        ]
      : []),
  ].filter((slide) => slide.urls.length > 0);
  const slide = slides[Math.min(activeIndex, Math.max(0, slides.length - 1))];
  const imageClass =
    variant === "grid"
      ? "absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      : "absolute inset-0 h-full w-full object-cover";
  const containerClass =
    variant === "grid"
      ? "absolute inset-0"
      : "relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-800";

  function requestMediaAfterHover() {
    if (mediaRequested || mediaRequestTimer.current) return;
    mediaRequestTimer.current = setTimeout(() => {
      setMediaRequested(true);
      mediaRequestTimer.current = null;
    }, 300);
  }

  function cancelPendingMediaRequest() {
    if (!mediaRequestTimer.current) return;
    clearTimeout(mediaRequestTimer.current);
    mediaRequestTimer.current = null;
  }

  useEffect(
    () => () => {
      if (mediaRequestTimer.current) clearTimeout(mediaRequestTimer.current);
    },
    [],
  );

  return (
    <div
      className={twMerge(containerClass, "group/media")}
      onMouseEnter={requestMediaAfterHover}
      onMouseLeave={cancelPendingMediaRequest}
      onFocusCapture={() => setMediaRequested(true)}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-surface-700 text-surface-500">
        <ImageOff className={variant === "grid" ? "h-7 w-7" : "h-4 w-4"} />
        {variant === "grid" && (
          <span className="max-w-[80%] truncate text-xs">{modName.charAt(0).toUpperCase()}</span>
        )}
      </div>
      {slide && <SlideImage key={slide.key} slide={slide} className={imageClass} />}
      {slide?.videoUrl && (
        <Tooltip content="Watch video preview">
          <a
            href={slide.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Watch ${modName} video preview`}
            className={twMerge(
              "absolute flex items-center justify-center rounded-full bg-surface-950/80 text-white shadow-md transition-colors hover:bg-accent-600",
              variant === "grid" ? "right-2 bottom-2 h-8 w-8" : "right-1 bottom-1 h-6 w-6",
            )}
          >
            <Play
              className={variant === "grid" ? "h-4 w-4 fill-current" : "h-3 w-3 fill-current"}
            />
          </a>
        </Tooltip>
      )}
      {slides.length > 1 && (
        <>
          <span className="absolute top-1.5 left-1.5 rounded bg-surface-950/75 px-1.5 py-0.5 text-[10px] text-white">
            {Math.min(activeIndex + 1, slides.length)}/{slides.length}
          </span>
          <SliderArrow
            direction="previous"
            variant={variant}
            onClick={() =>
              setActiveIndex((current) => (current - 1 + slides.length) % slides.length)
            }
          />
          <SliderArrow
            direction="next"
            variant={variant}
            onClick={() => setActiveIndex((current) => (current + 1) % slides.length)}
          />
        </>
      )}
    </div>
  );
}

interface MediaSlide {
  key: string;
  urls: string[];
  videoUrl: string | null;
}

function SlideImage({ slide, className }: { slide: MediaSlide; className: string }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [proxyIndex, setProxyIndex] = useState(0);
  const [proxyFinished, setProxyFinished] = useState(false);
  const [proxySource, setProxySource] = useState<string | null>(null);
  const source = slide.urls[sourceIndex];
  const proxyUrl = slide.urls[proxyIndex];
  const sourceCount = slide.urls.length;

  useEffect(() => {
    if (source || proxySource || proxyFinished || !proxyUrl) return;

    let cancelled = false;
    void api
      .getDownloadImageData(proxyUrl)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setProxySource(result.value);
        } else if (proxyIndex + 1 < sourceCount) {
          setProxyIndex((current) => current + 1);
        } else {
          setProxyFinished(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (proxyIndex + 1 < sourceCount) {
          setProxyIndex((current) => current + 1);
        } else {
          setProxyFinished(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [proxyFinished, proxyIndex, proxySource, proxyUrl, source, sourceCount]);

  const displaySource = source ?? proxySource;
  if (!displaySource) return null;
  return (
    <img
      src={displaySource}
      alt=""
      className={className}
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}

function SliderArrow({
  direction,
  variant,
  onClick,
}: {
  direction: "previous" | "next";
  variant: "grid" | "list";
  onClick: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = direction === "previous" ? "Previous preview" : "Next preview";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={twMerge(
        "absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-surface-950/75 text-white opacity-0 shadow-md transition-[opacity,background-color] group-hover/media:opacity-100 hover:bg-accent-600 focus-visible:opacity-100",
        direction === "previous" ? "left-1.5" : "right-1.5",
        variant === "grid" ? "h-7 w-7" : "h-5 w-5",
      )}
      onClick={onClick}
    >
      <Icon className={variant === "grid" ? "h-4 w-4" : "h-3 w-3"} />
    </button>
  );
}

function InstallModControl({
  siteId,
  mod,
  size,
  installing,
  onInstall,
}: {
  siteId: DownloadSiteId;
  mod: DownloadMod;
  size: "xs" | "sm";
  installing: boolean;
  onInstall: (mod: DownloadMod, release?: DownloadRelease) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const releases = useDownloadReleases(siteId, mod.id, menuOpen);
  const iconClass = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="inline-flex shrink-0">
      <Button
        variant="filled"
        size={size}
        className="rounded-r-none"
        left={<Download className={iconClass} />}
        loading={installing}
        onClick={() => onInstall(mod)}
      >
        Install latest
      </Button>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          disabled={installing}
          render={
            <Button
              variant="filled"
              size={size}
              className="-ml-px rounded-l-none border-l border-white/20"
              left={<ChevronDown className={iconClass} />}
              disabled={installing}
              aria-label={`Choose a version of ${mod.name}`}
              title="Choose version"
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="max-h-72 w-52 overflow-y-auto">
              <Menu.Group>
                <Menu.GroupLabel>Choose version</Menu.GroupLabel>
                {releases.isLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-surface-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading versions
                  </div>
                ) : releases.error ? (
                  <Menu.Item disabled>Could not load versions</Menu.Item>
                ) : releases.data?.length ? (
                  releases.data.map((release, index) => (
                    <Menu.Item
                      key={release.id}
                      icon={<Download className="h-4 w-4" />}
                      onClick={() => onInstall(mod, release)}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate">{release.tag}</span>
                        {index === 0 && (
                          <span className="text-[10px] font-medium text-accent-400">Latest</span>
                        )}
                      </span>
                    </Menu.Item>
                  ))
                ) : (
                  <Menu.Item disabled>No releases available</Menu.Item>
                )}
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function ModStats({ mod }: { mod: DownloadMod }) {
  return (
    <div className={twMerge("flex shrink-0 items-center gap-2.5 text-[11px] text-surface-500")}>
      <span className="inline-flex items-center gap-1">
        <Download className="h-3 w-3" /> {compactNumber(mod.downloadCount)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Eye className="h-3 w-3" /> {compactNumber(mod.viewCount)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Heart className="h-3 w-3" /> {compactNumber(mod.likeCount)}
      </span>
    </div>
  );
}
