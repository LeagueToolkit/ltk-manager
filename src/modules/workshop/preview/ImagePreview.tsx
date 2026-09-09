import { CheckerboardIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ReactZoomPanPinchContentRef,
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

import { Button, EmptyState, IconButton, Spinner, Tooltip } from "@/components";
import { useReducedMotion, useResizeObserver } from "@/hooks";
import { errorSummary } from "@/i18n";
import type { AppError, AssetInfo, AssetRef } from "@/lib/tauri";
import { usePreviewCheckered, useSetPreviewCheckered } from "@/stores";
import { twMerge } from "@/utils";
import { formatBytes } from "@/utils";

import { assetArchive, previewUrl } from "./assetRef";
import { BinPreview, isPropertyBin } from "./BinPreview";
import { useAssetInfo } from "./useAssetInfo";
import { useImageSlot } from "./useImageSlot";

/** How far a zoom reaches, either side of the image's own scale. */
const ZOOM_RANGE = [0.05, 32] as const;

/** What one step of the zoom controls multiplies the scale by. */
const ZOOM_STEP = 1.25;

/** That step as `zoomIn` and `zoomOut` take it, which is an exponent and not a factor. */
const ZOOM_EXPONENT = Math.log(ZOOM_STEP);

/** How long a step of the zoom controls takes to land. */
const ZOOM_ANIMATION_MS = 200;

/**
 * The wheel's zoom per pixel of scroll, as a share of the current scale.
 *
 * The library adds its step to the scale and does not multiply by it. One fixed
 * step is then a nudge at 3200% and a leap at 5%. A step that is itself a share
 * of the scale turns that sum back into a ratio. 100 pixels of wheel is a tenth
 * either way at every zoom.
 */
const WHEEL_STEP = 0.001;

/** What a fit leaves between the image and the pane, per side. */
const FIT_INSET = 16;

/** One checkerboard square, in screen pixels at any zoom. */
const CHECKER_SIZE = 16;

/** Under this the two scales are one scale, and no sync is due. */
const SCALE_EPSILON = 1e-6;

interface Size {
  width: number;
  height: number;
}

/** How a preview scales its asset. `fit` sizes it to the pane, a number multiplies its pixels. */
type PreviewZoom = "fit" | number;

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

  const [natural, setNatural] = useState<Size | null>(null);
  const [pane, setPane] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * The viewport, which is this preview's and no other preview's.
   *
   * A file opens on its whole image. The zoom of the last file does not reach
   * it. The alternative shares one zoom across the open previews, and then a
   * 3200% read of one texture is what the next texture opens at. The image is
   * another size, and the zoom says nothing about that.
   */
  const [zoom, setZoom] = useState<PreviewZoom>("fit");
  const controls = useRef<ReactZoomPanPinchContentRef>(null);

  /* A fresh asset in the same tab is a fresh load, so what the old one measured
     goes and the viewport goes with it. */
  useEffect(() => {
    setNatural(null);
    setFailed(false);
    setZoom("fit");
  }, [url]);

  const onResize = useCallback((width: number, height: number) => {
    setPane((prev) =>
      prev?.width === width && prev?.height === height ? prev : { width, height },
    );
  }, []);

  const fit = fitScale(natural, pane);

  if (failed) {
    return <PreviewUnavailable asset={asset} name={name} info={info.data} error={info.error} />;
  }

  return (
    <div data-ui="ImagePreview" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <Canvas
        url={url}
        archive={assetArchive(asset)}
        name={name}
        natural={natural}
        fit={fit}
        zoom={zoom}
        controls={controls}
        onResize={onResize}
        onZoom={setZoom}
        onLoad={setNatural}
        onError={() => setFailed(true)}
      />

      <StatusStrip
        info={info.data}
        natural={natural}
        fit={fit}
        zoom={zoom}
        controls={controls}
        onZoom={setZoom}
      />
    </div>
  );
}

/** The handle on one preview's transform, which the canvas fills and the strip drives. */
type Controls = RefObject<ReactZoomPanPinchContentRef | null>;

interface CanvasProps {
  url: string;
  /** The archive the pixels come from, for the line's order. */
  archive: string | null;
  name: string;
  natural: Size | null;
  fit: number;
  zoom: PreviewZoom;
  controls: Controls;
  onResize: (width: number, height: number) => void;
  onZoom: (zoom: PreviewZoom) => void;
  onLoad: (natural: Size) => void;
  onError: () => void;
}

/**
 * The pane a modder pans and zooms the image inside.
 *
 * `react-zoom-pan-pinch` owns the transform, and the transform is what answers
 * the wheel, the drag, the pinch and the double click. The image takes its own
 * pixel size and nothing but the transform scales it. The scale the library
 * reports and the zoom the strip reads are therefore one number.
 *
 * The transform is the record and `zoom` is the reading of it. This reports a
 * scale a pointer lands on, and it never reports a scale the pane was merely
 * told to take. That is what stops the two chasing each other.
 */
function Canvas({
  url,
  archive,
  name,
  natural,
  fit,
  zoom,
  controls,
  onResize,
  onZoom,
  onLoad,
  onError,
}: CanvasProps) {
  const checkered = usePreviewCheckered();
  const reduceMotion = useReducedMotion();
  /* The preview's lane, which the tiles and the swatches hold a slot open for. */
  const slot = useImageSlot(url, { lane: "preview", archive });

  const measure = useResizeObserver<HTMLDivElement>((element) =>
    onResize(element.clientWidth, element.clientHeight),
  );

  const scale = zoom === "fit" ? fit : zoom;

  const commanded = useRef(scale);
  useLayoutEffect(() => {
    commanded.current = scale;
  });

  const drawn = useRef<string | null>(null);

  /* Before the paint rather than after it, so a freshly decoded image is
     already at its scale the first frame it is on screen. */
  useLayoutEffect(() => {
    const api = controls.current;
    if (!api || !natural) return;

    const fresh = drawn.current !== url;
    drawn.current = url;

    /* A pan is the user's until the image under it changes, so only a fresh
       file and a re-fit move it. The strip reaches the transform directly. */
    if (!fresh) {
      if (api.instance.isAnimating) return;
      if (Math.abs(api.instance.state.scale - scale) < SCALE_EPSILON) return;
    }
    api.centerView(scale, 0);
  }, [url, natural, scale, controls]);

  const onTransform = useCallback(
    (_: ReactZoomPanPinchRef, state: { scale: number }) => {
      if (Math.abs(state.scale - commanded.current) < SCALE_EPSILON) return;
      onZoom(state.scale);
    },
    [onZoom],
  );

  return (
    <div
      ref={measure}
      data-ui="ImagePreview:canvas"
      className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
    >
      <TransformWrapper
        ref={controls}
        minScale={ZOOM_RANGE[0]}
        maxScale={ZOOM_RANGE[1]}
        /* A drag moves the image at every zoom, including one that fits. So
           no bounds hold it inside the pane and no edge draws it back, because
           either one would take the drag away again. */
        limitToBounds={false}
        autoAlignment={{ disabled: true }}
        velocityAnimation={{ disabled: true }}
        wheel={{ step: WHEEL_STEP * scale }}
        doubleClick={{ animationTime: reduceMotion ? 0 : ZOOM_ANIMATION_MS }}
        zoomAnimation={{ disabled: reduceMotion }}
        onTransform={onTransform}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          <img
            src={slot.src}
            alt={name}
            draggable={false}
            onLoad={(event) => {
              slot.onSettled();
              onLoad({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            onError={() => {
              slot.onSettled();
              onError();
            }}
            /* Counter the transform, so a square stays 16 screen pixels at 5%
               and at 3200% alike. */
            style={
              checkered
                ? { backgroundSize: `${CHECKER_SIZE / scale}px ${CHECKER_SIZE / scale}px` }
                : undefined
            }
            className={twMerge(
              "block max-w-none select-none",
              /* Nearest neighbour past 100%, so a modder reads the texels rather
                 than the webview's guess at what is between them. */
              scale >= 1 && "[image-rendering:pixelated]",
              checkered && CHECKERBOARD,
              !natural && "invisible",
            )}
          />
        </TransformComponent>
      </TransformWrapper>

      {!natural && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner size="md" />
        </div>
      )}
    </div>
  );
}

/* Two conic sweeps of one token, which reads as alpha wherever the image is
   transparent. A flat ground cannot: a dark texture and a hole look alike. */
export const CHECKERBOARD =
  "bg-[repeating-conic-gradient(var(--surface-800)_0%_25%,transparent_0%_50%)]";

/**
 * What scale draws the whole image inside the pane.
 *
 * Only ever a reduction. An icon smaller than the pane reads at its own size.
 * To fill the pane with it would show a modder texels of the webview's own
 * invention before they asked for any.
 */
function fitScale(natural: Size | null, pane: Size | null): number {
  if (!natural || !pane) return 1;

  const width = Math.max(pane.width - FIT_INSET * 2, 1);
  const height = Math.max(pane.height - FIT_INSET * 2, 1);
  return clamp(Math.min(1, width / natural.width, height / natural.height));
}

interface StatusStripProps {
  info: AssetInfo | undefined;
  natural: Size | null;
  fit: number;
  zoom: PreviewZoom;
  controls: Controls;
  onZoom: (zoom: PreviewZoom) => void;
}

/**
 * What the asset's header declares, and the controls that draw it.
 *
 * A zoom is a place as much as a scale, and a number cannot say where the image
 * sits. The steps therefore hand the whole gesture to the library, and the two
 * absolute zooms move this pane's transform themselves.
 */
function StatusStrip({ info, natural, fit, zoom, controls, onZoom }: StatusStripProps) {
  const checkered = usePreviewCheckered();
  const setCheckered = useSetPreviewCheckered();
  const reduceMotion = useReducedMotion();

  const scale = zoom === "fit" ? fit : zoom;
  const animation = reduceMotion ? 0 : ZOOM_ANIMATION_MS;

  /* The transform first and the report second. A move of the transform reports
     the scale it landed on. That number would otherwise arrive after this one
     and take the mode with it. */
  const goTo = (next: PreviewZoom) => {
    controls.current?.centerView(next === "fit" ? fit : next, 0);
    onZoom(next);
  };

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

        <Tooltip content="Zoom out">
          <IconButton
            variant="ghost"
            size="xs"
            compact
            icon={<MinusIcon className="h-4 w-4" weight="bold" />}
            disabled={scale <= ZOOM_RANGE[0]}
            onClick={() => controls.current?.zoomOut(ZOOM_EXPONENT, animation)}
          />
        </Tooltip>

        <Tooltip content="Actual size">
          <Button
            variant="ghost"
            size="xs"
            compact
            className="min-w-12 tabular-nums"
            onClick={() => goTo(1)}
          >
            {Math.round(scale * 100)}%
          </Button>
        </Tooltip>

        <Tooltip content="Zoom in">
          <IconButton
            variant="ghost"
            size="xs"
            compact
            icon={<PlusIcon className="h-4 w-4" weight="bold" />}
            disabled={scale >= ZOOM_RANGE[1]}
            onClick={() => controls.current?.zoomIn(ZOOM_EXPONENT, animation)}
          />
        </Tooltip>

        <Tooltip content="Fit to the pane">
          <Button
            variant="ghost"
            size="xs"
            compact
            aria-pressed={zoom === "fit"}
            className={zoom === "fit" ? "text-accent-300" : undefined}
            onClick={() => goTo("fit")}
          >
            Fit
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
      description={error ? errorSummary(error) : `${name} did not decode as an image.`}
    />
  );
}

function clamp(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_RANGE[0]), ZOOM_RANGE[1]);
}
