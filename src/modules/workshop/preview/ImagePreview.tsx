import { CheckerboardIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, EmptyState, IconButton, Spinner, Tooltip } from "@/components";
import type { AppError, AssetInfo, AssetRef } from "@/lib/tauri";
import {
  type PreviewZoom,
  usePreviewCheckered,
  usePreviewZoom,
  useSetPreviewCheckered,
  useSetPreviewZoom,
  useWorkshopLayoutStore,
} from "@/stores";
import { formatBytes } from "@/utils";

import { previewUrl } from "./assetRef";
import { BinPreview, isPropertyBin } from "./BinPreview";
import { useAssetInfo } from "./useAssetInfo";

/** How far `Ctrl` and the wheel reach, either side of the image's own scale. */
const ZOOM_RANGE = [0.05, 32] as const;

interface ImagePreviewProps {
  asset: AssetRef;
  /** The file name, which the document resolved. A reference may hold a hash. */
  name: string;
}

/**
 * One asset drawn as an image, with what its header declares below it.
 *
 * The pixels arrive over the `ltk-asset` protocol rather than over IPC, so the
 * webview decodes them itself and the image never reaches the JavaScript heap.
 * The facts beside them are a separate request, because an `<img>` knows its
 * dimensions and nothing else about the file it came from.
 */
export function ImagePreview({ asset, name }: ImagePreviewProps) {
  const info = useAssetInfo(asset);
  const url = useMemo(() => previewUrl(asset), [asset]);

  const zoom = usePreviewZoom();
  const checkered = usePreviewCheckered();
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  /* A fresh asset in the same tab is a fresh load, so what the old one measured
     goes. The zoom stays, because it is every preview's and not this one's. */
  useEffect(() => {
    setNatural(null);
    setFailed(false);
  }, [url]);

  /* Read at the wheel rather than through the hook, so the listener the canvas
     binds survives a zoom instead of rebinding on each notch of it. */
  const zoomBy = useCallback((factor: number) => {
    const { previewZoom, setPreviewZoom } = useWorkshopLayoutStore.getState();
    const from = typeof previewZoom === "number" ? previewZoom : 1;
    setPreviewZoom(clamp(from * factor));
  }, []);

  if (failed) {
    return <PreviewUnavailable asset={asset} name={name} info={info.data} error={info.error} />;
  }

  return (
    <div data-ui="ImagePreview" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <Canvas
        url={url}
        name={name}
        zoom={zoom}
        natural={natural}
        checkered={checkered}
        onLoad={setNatural}
        onError={() => setFailed(true)}
        onZoomBy={zoomBy}
      />

      <StatusStrip info={info.data} natural={natural} />
    </div>
  );
}

interface CanvasProps {
  url: string;
  name: string;
  zoom: PreviewZoom;
  natural: { width: number; height: number } | null;
  checkered: boolean;
  onLoad: (natural: { width: number; height: number }) => void;
  onError: () => void;
  onZoomBy: (factor: number) => void;
}

function Canvas({ url, name, zoom, natural, checkered, onLoad, onError, onZoomBy }: CanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  /* A non-passive listener, because `preventDefault` on a wheel event is what
     stops the webview zooming the whole page under Ctrl, and React attaches
     its own wheel handlers passively. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      onZoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onZoomBy]);

  const scaled = typeof zoom === "number" && natural;

  return (
    <div
      ref={scrollRef}
      data-ui="ImagePreview:canvas"
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
    >
      {!natural && (
        <div className="absolute">
          <Spinner size="md" />
        </div>
      )}
      <img
        src={url}
        alt={name}
        draggable={false}
        onLoad={(event) =>
          onLoad({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        onError={onError}
        style={scaled ? { width: natural.width * zoom, height: natural.height * zoom } : undefined}
        className={twMerge(
          "shrink-0 select-none",
          /* Nearest neighbour past 100%, so a modder reads the texels rather
             than the webview's guess at what is between them. */
          "[image-rendering:pixelated]",
          !scaled && "max-h-full max-w-full object-contain",
          checkered && CHECKERBOARD,
          !natural && "invisible",
        )}
      />
    </div>
  );
}

/* Two conic sweeps of one token, which reads as alpha wherever the image is
   transparent. A flat ground cannot: a dark texture and a hole look alike. */
const CHECKERBOARD =
  "bg-[repeating-conic-gradient(var(--surface-800)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]";

interface StatusStripProps {
  info: AssetInfo | undefined;
  natural: { width: number; height: number } | null;
}

/**
 * What the asset's header declares, and the controls that draw it.
 *
 * The two controls read the shared view state rather than taking it from the
 * preview above, so a strip in one split answers for every preview open.
 */
function StatusStrip({ info, natural }: StatusStripProps) {
  const zoom = usePreviewZoom();
  const setZoom = useSetPreviewZoom();
  const checkered = usePreviewCheckered();
  const setCheckered = useSetPreviewCheckered();

  const facts: string[] = [];

  const size = dimensions(info) ?? natural;
  if (size) facts.push(`${size.width} × ${size.height}`);

  if (info?.kind === "texture") {
    facts.push(info.format ? `${info.container} · ${info.format}` : info.container);
    if (info.mipCount > 1) facts.push(`${info.mipCount} mips`);
  }
  if (info && info.kind !== "unsupported") facts.push(formatBytes(Number(info.sizeBytes)));

  return (
    <div
      data-ui="ImagePreview:status"
      className="flex h-8 shrink-0 items-center gap-3 border-t border-surface-700/50 bg-surface-900 px-3 font-mono text-xs text-surface-400 select-none"
    >
      {facts.map((fact) => (
        <span key={fact} className="select-text">
          {fact}
        </span>
      ))}

      <div className="ml-auto flex items-center gap-1">
        <Tooltip
          content={checkered ? "Hide the alpha checkerboard" : "Show the alpha checkerboard"}
        >
          <IconButton
            variant="ghost"
            size="xs"
            compact
            aria-pressed={checkered}
            icon={<CheckerboardIcon className="h-4 w-4" weight="bold" />}
            className={checkered ? "text-accent-300" : undefined}
            onClick={() => setCheckered(!checkered)}
          />
        </Tooltip>

        <Tooltip content={zoom === "fit" ? "Actual size" : "Fit to the pane"}>
          <Button
            variant="ghost"
            size="xs"
            compact
            className="tabular-nums"
            onClick={() => setZoom(zoom === "fit" ? 1 : "fit")}
          >
            {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function dimensions(info: AssetInfo | undefined) {
  if (info?.kind === "texture" || info?.kind === "image") {
    return { width: info.width, height: info.height };
  }
  return null;
}

interface PreviewUnavailableProps {
  asset: AssetRef;
  name: string;
  info: AssetInfo | undefined;
  error: AppError | null;
}

/**
 * Why nothing is on screen.
 *
 * The `<img>` reports that it failed and never why, so the reason comes from
 * the facts request that ran beside it.
 */
function PreviewUnavailable({ asset, name, info, error }: PreviewUnavailableProps) {
  if (info?.kind === "unsupported") {
    /* A chunk no hash table names reaches the document without an extension,
       so the bytes are what said it was a bin. */
    if (isPropertyBin(info.fileKind)) return <BinPreview asset={asset} name={name} />;

    return (
      <EmptyState
        size="sm"
        className="h-full"
        title="No preview for this file"
        description={`${name} is a file type the editor cannot draw yet.`}
      />
    );
  }

  return (
    <EmptyState
      size="sm"
      className="h-full"
      title="Could not read this file"
      description={error?.message ?? `${name} did not decode as an image.`}
    />
  );
}

function clamp(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_RANGE[0]), ZOOM_RANGE[1]);
}
