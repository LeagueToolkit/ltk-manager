import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Code, Popover, Readout } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, DeclaredObject } from "@/lib/tauri";

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
}

/**
 * A `link` or a `hash` as a chip that opens the object tab, per "Links" in
 * docs/ux/BIN_EDITOR.md.
 *
 * A click that lands while the index is absent builds it. The tree opens the target
 * on the check's answer.
 */
export function ObjectChip({ hash, name, kind }: ObjectChipProps) {
  const targets = useLinkTargets();
  const declared = targets.declared.get(hash);
  const decision = kind === "link" ? decideObjectLink(hash, targets) : decideHash(hash, targets);
  const { wantOpen, wanting } = useLinkOpen();
  const open = useOpenDocumentAs();

  const label = name ?? declared?.path ?? hash;
  if (decision.kind === "text" && kind === "link") return <Hex>{hash}</Hex>;
  if (decision.kind === "text") return <Text>{label}</Text>;
  if (decision.kind === "pending") return <Text>{label}</Text>;
  if (decision.kind === "warm") {
    return (
      <LinkChip
        label={label}
        pending={wanting.has(hash)}
        onOpen={(intent) => wantOpen(hash, intent)}
      />
    );
  }

  return (
    <LinkChip
      label={label}
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
  if (decision.kind !== "chip") return <Text>{path}</Text>;
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

  if (decision.kind !== "chip") return <Readout value={text} className="flex-1 text-surface-100" />;
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
      <LinkChip label={path} onOpen={onOpen} />
      <FileMark asset={document.asset} path={path} layerTitle={layerTitle} onOpen={onOpen} />
      {side !== undefined && <span className="shrink-0 text-meta text-surface-400">{side}</span>}
    </span>
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
  /** The click was taken and the index is building. */
  pending?: boolean;
  /** The hover card. Absent while the target is not resolved. */
  card?: ReactNode;
  onOpen: (intent: OpenIntent) => void;
}

/** A mono `Code` chip, per DS-CODE-CHIP, opening on click and beside on `Ctrl+click`. */
export function LinkChip({ label, pending = false, card, onOpen }: LinkChipProps) {
  const button = (
    <button
      type="button"
      data-ui="LinkChip"
      className={twMerge(
        "max-w-full min-w-0 cursor-pointer truncate rounded-sm text-left",
        pending && "animate-pulse",
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onOpen(clickIntent(event));
      }}
    >
      <Code className="hover:bg-surface-veil hover:text-surface-100">{label}</Code>
    </button>
  );
  if (!card) return button;

  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={CARD_DELAY} render={button} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6}>
          <Popover.Popup aria-label={label} className="w-80 p-3 text-meta select-none">
            {card}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

function Text({ children }: { children: ReactNode }) {
  return <span className="truncate text-surface-200 select-text">{children}</span>;
}

function Hex({ children }: { children: ReactNode }) {
  return <span className="truncate text-surface-400 select-text">{children}</span>;
}
