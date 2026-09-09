import { FolderIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import type { AssetRef, WorkshopFileKind } from "@/lib/tauri";
import { usePreviewCheckered } from "@/stores";
import { twMerge } from "@/utils";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import { assetArchive, previewUrl } from "../preview/assetRef";
import { CHECKERBOARD } from "../preview/ImagePreview";
import { useImageSlot } from "../preview/useImageSlot";
import { describeFileKind } from "../utils/fileKindIcon";
import type { ExplorerItem } from "./items";

/** The kinds the backend has a viewer for, which are the only ones worth a thumbnail. */
const DRAWN_KINDS: ReadonlySet<WorkshopFileKind> = new Set([
  "texture",
  "texture_dds",
  "png",
  "jpeg",
  "tga",
  "svg",
]);

/**
 * How much of the box a glyph takes, which is a tile's plate and a row's box.
 *
 * A tile draws its glyph inside a plate several times the glyph's size, and a
 * row's box is the glyph, so the same fraction cannot serve both.
 */
type ArtVariant = "tile" | "row";

export interface ExplorerArtProps {
  item: ExplorerItem;
  /** The art's drawn box in px, which the zoom has already been applied to. */
  box: number;
  /**
   * The width a thumbnail is asked for, which is one of the six tile sizes.
   *
   * The drawn box follows the zoom and this does not, so the scheme is asked
   * for six widths over a session rather than one per zoom step.
   */
  requestWidth: number;
  thumbnails: boolean;
  /** Where the bytes come from, so a game chunk's `<img>` names its archive. */
  assetOf: (item: ExplorerItem) => AssetRef | null;
  variant: ArtVariant;
}

/** What an explorer draws for an item: its asset, its kind, or a folder. */
export function ExplorerArt({
  item,
  box,
  requestWidth,
  thumbnails,
  assetOf,
  variant,
}: ExplorerArtProps) {
  if (item.kind === "dir") {
    return (
      <Plate box={box} variant={variant}>
        {/* The hue is what says directory, and it is an identity and not a status: DS-KIND-HUE. */}
        <FolderIcon
          weight="fill"
          className={twMerge(
            "text-folder-text",
            variant === "tile" ? "h-1/2 w-1/2" : "h-4/5 w-4/5",
          )}
        />
      </Plate>
    );
  }

  const kind = item.entry.path === null ? "unknown" : fileKindFromPath(item.entry.path);
  const asset = assetOf(item);

  if (!thumbnails || asset === null || !DRAWN_KINDS.has(kind)) {
    return <KindArt kind={kind} box={box} variant={variant} />;
  }

  return (
    <Thumbnail asset={asset} kind={kind} box={box} requestWidth={requestWidth} variant={variant} />
  );
}

interface PlateProps {
  box: number;
  variant: ArtVariant;
  children: ReactNode;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/* A tile's art spans the tile and a row's art is a square beside the name, so
   the width is the one geometry the two variants do not share. */
function Plate({ box, variant, children, label, className, style }: PlateProps) {
  return (
    <span
      aria-label={label}
      className={twMerge(
        "grid shrink-0 place-items-center rounded-sm bg-surface-veil-soft",
        variant === "tile" && "w-full",
        className,
      )}
      style={{
        height: `${box}px`,
        ...(variant === "row" && { width: `${box}px` }),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

interface KindArtProps {
  kind: WorkshopFileKind;
  box: number;
  variant: ArtVariant;
}

function KindArt({ kind, box, variant }: KindArtProps) {
  const descriptor = describeFileKind(kind);
  const Icon = descriptor.icon;

  return (
    <Plate
      box={box}
      variant={variant}
      label={descriptor.label}
      style={{ color: `var(${descriptor.tintToken})` }}
    >
      <Icon className={variant === "tile" ? "h-2/5 w-2/5" : "h-3/5 w-3/5"} strokeWidth={1.5} />
    </Plate>
  );
}

interface ThumbnailProps {
  asset: AssetRef;
  kind: WorkshopFileKind;
  box: number;
  requestWidth: number;
  variant: ArtVariant;
}

/**
 * The asset itself, decoded at the width the view asks for.
 *
 * The `ltk-asset` scheme renders whatever the backend has a viewer for, so
 * nothing crosses the JavaScript heap, and `w` picks the smallest mipmap still
 * at least that wide. A texture the protocol cannot draw falls back to its kind.
 */
function Thumbnail({ asset, kind, box, requestWidth, variant }: ThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const checkered = usePreviewCheckered();
  const slot = useImageSlot(previewUrl(asset, requestWidth), {
    lane: "tile",
    archive: assetArchive(asset),
  });

  if (failed) return <KindArt kind={kind} box={box} variant={variant} />;

  const descriptor = describeFileKind(kind);

  return (
    <Plate
      box={box}
      variant={variant}
      className={twMerge(
        "relative overflow-hidden",
        checkered && variant === "tile" && CHECKERBOARD,
        checkered && variant === "tile" && "[background-size:12px_12px]",
      )}
    >
      {slot.src !== undefined && (
        <img
          src={slot.src}
          alt=""
          draggable={false}
          onLoad={slot.onSettled}
          onError={() => {
            slot.onSettled();
            setFailed(true);
          }}
          className="h-full w-full object-contain"
        />
      )}
      {/* A .tex and a .dds of the same art read apart only by this badge, and a
          row has no room for it, so a row reads them apart by its kind column. */}
      {variant === "tile" && (
        <span
          className="absolute right-0.5 bottom-0.5 rounded-sm bg-scrim px-1 text-fine text-surface-200"
          style={{ color: `var(${descriptor.tintToken})` }}
        >
          {kindTag(kind)}
        </span>
      )}
    </Plate>
  );
}

/** The short word a badge fits, which is the container rather than the kind's full name. */
function kindTag(kind: WorkshopFileKind): string {
  if (kind === "texture") return "tex";
  if (kind === "texture_dds") return "dds";
  return kind.slice(0, 4);
}
