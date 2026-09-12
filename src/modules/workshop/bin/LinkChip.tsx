import { ArchiveIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { Code, LayerIcon, Popover, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, DeclaredObject } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { type ContentDocumentOf, declaringFileContext } from "../documents/contentDocument";
import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { OpenIntent } from "../palette/types";
import { useAssetInfo } from "../preview/useAssetInfo";
import { clickIntent, useOpenDocumentAs } from "../state";
import { nameHash } from "./binHash";
import { fileLinkMark } from "./fileLinkMark";
import { KindBadge } from "./KindBadge";
import {
  chunkPath,
  decideFileLink,
  decideHash,
  decideObjectLink,
  decideStringLink,
} from "./linkDecision";
import { splitPath } from "./textCut";
import { TextureSwatch } from "./TextureSwatch";
import { useLayerCopy, useLinkOpen, useLinkTargets } from "./useLinkTargets";

/** Hover for this long opens the card, the tooltip delay. */
const CARD_DELAY = 600;

interface ObjectChipProps {
  /** `0x` and eight hex digits. */
  hash: string;
  /** The object's path as the tables name it. Null where no table does. */
  name: string | null;
  /** A `link` value, which draws dim hex where nothing declares it. A `hash` stays text. */
  kind: "link" | "hash";
  /**
   * How the chip reads the path: whole with its folder cut first, or its last segment
   * alone where every row of a list shares the folder. The whole path is on hover either way.
   */
  reading?: "path" | "name";
}

/**
 * A `link` or a `hash` as a chip that opens the object tab, per "Links" in
 * docs/ux/BIN_EDITOR.md.
 *
 * A click that lands while the index is absent builds it. The tree opens the target
 * on the check's answer.
 */
export function ObjectChip({ hash, name, kind, reading = "path" }: ObjectChipProps) {
  const targets = useLinkTargets();
  const declared = targets.declared.get(hash);
  const decision = kind === "link" ? decideObjectLink(hash, targets) : decideHash(hash, targets);
  const { wantOpen, wanting } = useLinkOpen();
  const open = useOpenDocumentAs();

  const whole = name ?? declared?.path ?? hash;
  const label = reading === "name" ? splitPath(whole).file : whole;
  const cut = reading === "path" && whole.includes("/") ? "path" : "end";
  if (decision.kind === "text" && kind === "link") return <Hex>{hash}</Hex>;
  if (decision.kind === "text") return <Text>{whole}</Text>;
  if (decision.kind === "pending" && kind === "link") {
    return <PendingChip label={label} whole={whole} />;
  }
  if (decision.kind === "pending") return <Text>{whole}</Text>;
  if (decision.kind === "warm") {
    return (
      <LinkChip
        label={label}
        whole={whole}
        cut={cut}
        pending={wanting.has(hash)}
        onOpen={(intent) => wantOpen(hash, intent)}
      />
    );
  }

  return (
    <LinkChip
      label={label}
      whole={whole}
      cut={cut}
      card={declared && <TargetCard hash={hash} declared={declared} />}
      onOpen={(intent) => open(decision.document, intent)}
    />
  );
}

interface FileChipProps {
  /** Sixteen hex digits. */
  hash: string;
  /** The chunk's path as the tables name it. Null where no table does. */
  path: string | null;
}

/**
 * A `file` link as a chip that opens the chunk's preview, carrying the side that
 * answered: the layer's title, or the archive's name.
 *
 * A texture carries its swatch after the chip, and any other kind its badge.
 */
export function FileChip({ hash, path }: FileChipProps) {
  const targets = useLinkTargets();
  const layer = useLayerCopy(path);
  const decision = decideFileLink(path, targets, layer);

  if (path === null) return <Hex>{hash}</Hex>;
  if (decision.kind !== "chip") return <Text missing={decision.kind === "missing"} path={path} />;
  return (
    <ChunkChip
      document={decision.document}
      path={path}
      side={decision.side}
      layerTitle={layer?.title}
    />
  );
}

interface StringValueProps {
  /** The string as the file holds it, which is what a miss draws and what a hit hashes. */
  text: string;
}

/**
 * A `string` as the chip the thing it names draws, per "A string that names a thing" in
 * docs/ux/BIN_EDITOR.md.
 *
 * A miss on both sides is the field the string draws when it names nothing.
 */
export function StringValue({ text }: StringValueProps) {
  const targets = useLinkTargets();
  const path = chunkPath(text);
  const layer = useLayerCopy(path);
  const open = useOpenDocumentAs();
  const decision = decideStringLink(text, targets, () => layer);

  if (decision.kind === "missing" && path !== null) return <Text missing path={path} />;
  if (decision.kind === "missing") return <Text missing>{text}</Text>;
  if (decision.kind !== "chip") return <Text>{text}</Text>;
  const { document } = decision;
  if (document.kind === "preview" && path !== null) {
    return <ChunkChip document={document} path={path} layerTitle={layer?.title} />;
  }

  const hash = nameHash(text);
  const declared = targets.declared.get(hash);
  return (
    <LinkChip
      label={declared?.path ?? text}
      card={declared && <TargetCard hash={hash} declared={declared} />}
      onOpen={(intent) => open(document, intent)}
    />
  );
}

interface ChunkChipProps {
  document: ContentDocumentOf<"preview">;
  /** The chunk's path as the tables name it, which is the chip's label. */
  path: string;
  /** The word the chip carries: the layer's title, or the archive's name. */
  side?: string;
  layerTitle?: string;
}

/** A resolved chunk: its chip, its swatch or badge, and the side that answered. */
function ChunkChip({ document, path, side, layerTitle }: ChunkChipProps) {
  const open = useOpenDocumentAs();
  const onOpen = (intent: OpenIntent) => open(document, intent);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <LinkChip label={path} cut="path" onOpen={onOpen} />
      <FileMark asset={document.asset} path={path} layerTitle={layerTitle} onOpen={onOpen} />
      {side !== undefined && <SideTag side={side} layer={layerTitle !== undefined} />}
    </span>
  );
}

/** Which side answered a `file` chip, marked as a layer or an archive and named in full on hover. */
function SideTag({ side, layer }: { side: string; layer: boolean }) {
  const label = layer
    ? m.workshop_bin_chip_layer_label({ name: side })
    : m.workshop_bin_chip_archive_label({ name: side });

  return (
    <Tooltip content={label}>
      <span className="flex max-w-40 min-w-0 shrink items-center gap-1 text-meta text-surface-400">
        {/* DS-KIND-HUE */}
        {layer && <LayerIcon className="h-3 w-3 shrink-0 text-doc-layer-text" />}
        {!layer && <ArchiveIcon className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 truncate">{side}</span>
      </span>
    </Tooltip>
  );
}

interface FileMarkProps {
  asset: AssetRef;
  path: string;
  layerTitle?: string;
  onOpen: (intent: OpenIntent) => void;
}

/** The swatch or the badge after a `file` chip. The bytes are asked for a name with no extension. */
function FileMark({ asset, path, layerTitle, onOpen }: FileMarkProps) {
  const named = fileKindFromPath(path);
  const sniffed = useAssetInfo(asset, named === "unknown");
  const mark = fileLinkMark(named, sniffed.isError ? null : sniffed.data);

  if (mark.kind === "pending") return null;
  if (mark.kind === "badge") return <KindBadge fileKind={mark.fileKind} />;
  return (
    <TextureSwatch
      asset={asset}
      path={path}
      fileKind={named}
      layerTitle={layerTitle}
      onOpen={onOpen}
    />
  );
}

interface LinkChipProps {
  label: string;
  /** The whole of what the chip names, where the label draws a part of it. */
  whole?: string;
  /** Where a label too long for its box is cut: its end, or a path's folder. */
  cut?: "end" | "path";
  /** The click was taken and the index is building. */
  pending?: boolean;
  /** The hover card. Absent while the target is not resolved. */
  card?: ReactNode;
  onOpen: (intent: OpenIntent) => void;
}

/**
 * A mono `Code` chip, per DS-CODE-CHIP, opening on click and beside on `Ctrl+click`.
 *
 * A path is cut inside its folder, so both the root that names the champion and the
 * file name stay.
 */
export function LinkChip({
  label,
  whole = label,
  cut = "end",
  pending = false,
  card,
  onOpen,
}: LinkChipProps) {
  const path = cut === "path";
  const partial = path || whole !== label;
  const button = (
    <button
      type="button"
      data-ui="LinkChip"
      aria-label={partial ? whole : undefined}
      title={partial && !card ? whole : undefined}
      className={twMerge(
        "max-w-full min-w-0 cursor-pointer truncate rounded-sm text-left",
        path && "flex",
        pending && "animate-pulse",
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onOpen(clickIntent(event));
      }}
    >
      <Code
        className={twMerge("hover:bg-surface-veil hover:text-surface-100", path && "flex min-w-0")}
      >
        {path && <PathText path={label} />}
        {!path && label}
      </Code>
    </button>
  );
  if (!card) return button;

  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={CARD_DELAY} render={button} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6}>
          <Popover.Popup aria-label={whole} className="w-80 p-3 text-meta select-none">
            {card}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A path with its folder dimmed, the folder cut first where the box runs out. */
function PathText({ path }: { path: string }) {
  const { folder, file } = splitPath(path);
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 shrink-1000 truncate text-surface-400">{folder}</span>
      <span className="min-w-0 truncate">{file}</span>
    </span>
  );
}

/** A link whose target the check has not answered yet: its chip, dimmed, which opens nothing. */
function PendingChip({ label, whole }: { label: string; whole: string }) {
  return (
    <span className="flex min-w-0" title={whole}>
      {/* DS-CODE-CHIP */}
      <Code className="min-w-0 truncate text-surface-400 select-text">{label}</Code>
    </span>
  );
}

/** The target's path, its class, its declaring file and its declaration count. */
function TargetCard({ hash, declared }: { hash: string; declared: DeclaredObject }) {
  const [first] = declared.declarations;
  return (
    <div data-ui="LinkChip:card" className="flex flex-col gap-2">
      <header className="flex min-w-0 flex-col items-start gap-1">
        <span className="max-w-full truncate text-row font-medium text-surface-100 select-text">
          {declared.path}
        </span>
        <Code className="select-text">{hash}</Code>
      </header>
      {first && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-surface-400">{m.workshop_bin_class_label()}</dt>
          <dd className="min-w-0 truncate text-surface-200 select-text">{first.class}</dd>
          <dt className="text-surface-400">{m.workshop_bin_declared_in_label()}</dt>
          <dd className="min-w-0 truncate font-mono text-code text-surface-200 select-text">
            {declaringFileContext(first.asset, first.file)}
          </dd>
        </dl>
      )}
      <span className="text-surface-400">
        {m.workshop_bin_declarations_label({ count: declared.declarations.length })}
      </span>
    </div>
  );
}

/**
 * A path drawn as text, marked where nothing on this machine holds the chunk.
 *
 * "A chunk nothing holds" in docs/ux/BIN_EDITOR.md. One component draws both, so the
 * check answering marks the row it already drew instead of replacing it.
 */
function Text({
  children,
  missing = false,
  path,
}: {
  children?: ReactNode;
  missing?: boolean;
  /** A path, cut from its start as a path chip is. */
  path?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        title={path}
        className={twMerge(
          "min-w-0 text-left select-text",
          path === undefined ? "truncate" : "flex",
          missing ? "text-surface-300" : "text-surface-200",
        )}
      >
        {path !== undefined && <PathText path={path} />}
        {path === undefined && children}
      </span>
      {missing && (
        <Tooltip content={m.workshop_bin_missing_chunk_description()}>
          <WarningCircleIcon weight="bold" className="h-3.5 w-3.5 shrink-0 text-warning-text" />
        </Tooltip>
      )}
    </span>
  );
}

function Hex({ children }: { children: ReactNode }) {
  return <span className="truncate text-surface-400 select-text">{children}</span>;
}
