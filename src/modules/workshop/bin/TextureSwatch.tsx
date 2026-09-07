import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Popover, Spinner } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, TextureInfo, WorkshopFileKind } from "@/lib/tauri";
import { usePreviewCheckered } from "@/stores";

import type { OpenIntent } from "../palette/types";
import { assetArchive, previewUrl } from "../preview/assetRef";
import { CHECKERBOARD } from "../preview/ImagePreview";
import { useAssetInfo } from "../preview/useAssetInfo";
import { useImageSlot } from "../preview/useImageSlot";
import { clickIntent } from "../state";
import { KindBadge } from "./KindBadge";

/** The `w` a row swatch asks for: the mipmap that covers 20px, and reads on a 2x display. */
export const SWATCH_WIDTH = 32;

/** The `w` a tile asks for: the mipmap that covers 48px, and reads on a 2x display. */
export const TILE_WIDTH = 96;

/** How big the swatch is drawn, and which mipmap that asks for. */
const SIZES = {
  row: { box: "h-5 w-5", width: SWATCH_WIDTH },
  tile: { box: "h-12 w-12", width: TILE_WIDTH },
} as const;

/** The `w` the hover card asks for, and the card's own width. */
export const CARD_WIDTH = 256;

/** Hover for this long opens the card, the tooltip delay. */
const CARD_DELAY = 600;

interface TextureSwatchProps {
  asset: AssetRef;
  /** The chunk's path as the tables name it. */
  path: string;
  /** The kind the badge takes where the pixels fail to arrive. */
  fileKind: WorkshopFileKind;
  /** The layer's title, for the card of a layer's copy. */
  layerTitle?: string;
  /** The room it takes: a row's own height, or the 48px tile a sampler table draws. */
  size?: keyof typeof SIZES;
  onOpen: (intent: OpenIntent) => void;
}

/**
 * A texture's pixels at row height after its `file` chip, per "A WAD chunk link" in
 * docs/ux/BIN_EDITOR.md.
 *
 * The swatch opens the preview as the chip does, and a hover opens the card. A
 * texture the protocol cannot draw falls back to its kind badge.
 */
export function TextureSwatch({
  asset,
  path,
  fileKind,
  layerTitle,
  size = "row",
  onOpen,
}: TextureSwatchProps) {
  const [failed, setFailed] = useState(false);
  const slot = useImageSlot(previewUrl(asset, SIZES[size].width), {
    lane: "tile",
    archive: assetArchive(asset),
  });

  if (failed) return <KindBadge fileKind={fileKind} />;

  const button = (
    <button
      type="button"
      data-ui="TextureSwatch"
      aria-label={m.workshop_bin_texture_swatch_label()}
      /* DS-VEIL, DS-HOVER */
      className={twMerge(
        "shrink-0 cursor-pointer overflow-hidden rounded-sm border border-surface-veil-strong bg-surface-veil-soft hover:border-accent-hover",
        SIZES[size].box,
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onOpen(clickIntent(event));
      }}
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
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );

  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={CARD_DELAY} render={button} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6}>
          <Popover.Popup aria-label={path} className="p-3 text-meta select-none">
            <TextureCard asset={asset} path={path} layerTitle={layerTitle} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

type TextureCardProps = Pick<TextureSwatchProps, "asset" | "path" | "layerTitle">;

/** The texture at 256px over the checkerboard, its path, and the facts its header declares. */
function TextureCard({ asset, path, layerTitle }: TextureCardProps) {
  const info = useAssetInfo(asset);
  const checkered = usePreviewCheckered();
  const slot = useImageSlot(previewUrl(asset, CARD_WIDTH), {
    lane: "tile",
    archive: assetArchive(asset),
  });
  const [loaded, setLoaded] = useState(false);
  const texture = info.data?.kind === "texture" ? info.data : null;

  return (
    <div data-ui="TextureSwatch:card" className="flex w-64 flex-col gap-2">
      <div
        className={twMerge(
          "relative grid h-64 w-64 place-items-center overflow-hidden rounded-sm bg-surface-950/40",
          checkered && CHECKERBOARD,
          checkered && "[background-size:16px_16px]",
        )}
      >
        {slot.src !== undefined && (
          <img
            src={slot.src}
            alt={path}
            draggable={false}
            onLoad={() => {
              slot.onSettled();
              setLoaded(true);
            }}
            onError={slot.onSettled}
            className={twMerge("max-h-full max-w-full object-contain", !loaded && "invisible")}
          />
        )}
        {!loaded && <Spinner size="sm" className="absolute" />}
      </div>
      <span className="truncate font-mono text-code text-surface-100 select-text">{path}</span>
      {texture && <TextureFacts texture={texture} asset={asset} layerTitle={layerTitle} />}
    </div>
  );
}

interface TextureFactsProps {
  texture: TextureInfo;
  asset: AssetRef;
  layerTitle?: string;
}

function TextureFacts({ texture, asset, layerTitle }: TextureFactsProps) {
  const { container, format } = texture;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-surface-400">{m.workshop_bin_texture_size_label()}</dt>
      <dd className="text-surface-200 select-text">
        {m.workshop_bin_texture_dimensions_label({ width: texture.width, height: texture.height })}
      </dd>
      <dt className="text-surface-400">{m.workshop_bin_texture_format_label()}</dt>
      <dd className="text-surface-200 select-text">
        {format === null && container}
        {format !== null && m.workshop_bin_texture_container_format_label({ container, format })}
      </dd>
      <dt className="text-surface-400">{m.workshop_bin_texture_mips_label()}</dt>
      <dd className="text-surface-200 select-text">{texture.mipCount}</dd>
      {asset.kind === "gameChunk" && (
        <>
          <dt className="text-surface-400">{m.workshop_bin_archive_label()}</dt>
          <dd className="min-w-0 truncate font-mono text-code text-surface-200 select-text">
            {asset.wad}
          </dd>
        </>
      )}
      {asset.kind === "layer" && layerTitle !== undefined && (
        <>
          <dt className="text-surface-400">{m.workshop_bin_layer_label()}</dt>
          <dd className="min-w-0 truncate text-surface-200 select-text">{layerTitle}</dd>
        </>
      )}
    </dl>
  );
}
