import type { AssetRef, BinValue } from "@/lib/tauri";

import {
  type ContentDocument,
  type ContentDocumentOf,
  objectDocument,
  previewDocument,
} from "../documents/contentDocument";
import { assetContext, assetKey } from "../preview/assetRef";
import { nameHash } from "./binHash";
import type { LinkTargets } from "./useLinkTargets";

/** How a link value draws, and what its chip opens. "Links" in docs/ux/BIN_EDITOR.md. */
export type LinkDecision =
  | {
      /** A chip that opens `document`. `side` is the word a `file` chip carries. */
      readonly kind: "chip";
      readonly document: ContentDocument;
      readonly side?: string;
    }
  | {
      /** A chip whose click builds the index. The target opens on the answer. */
      readonly kind: "warm";
    }
  | {
      /** The check has not answered. */
      readonly kind: "pending";
    }
  | {
      /** No chip: dim hex for a `link`, text for a `hash` and a `file`. */
      readonly kind: "text";
    };

/** A path that resolved and that nothing on this machine holds. */
export interface MissingChunk {
  readonly kind: "missing";
}

/** A `file` link's decision, whose chip opens a preview. */
export type FileLinkDecision =
  | Exclude<LinkDecision, { kind: "chip" }>
  | MissingChunk
  | {
      readonly kind: "chip";
      readonly document: ContentDocumentOf<"preview">;
      readonly side?: string;
    };

/** The copy of a chunk path a layer holds, for the layer side of a `file` link. */
export interface LayerCopy {
  readonly asset: AssetRef;
  /** The layer's title, which is the word the chip carries. */
  readonly title: string;
}

const TEXT = { kind: "text" } as const satisfies LinkDecision;
const MISSING = { kind: "missing" } as const satisfies MissingChunk;
const WARM = { kind: "warm" } as const satisfies LinkDecision;
const PENDING = { kind: "pending" } as const satisfies LinkDecision;

/**
 * What an `ObjectLink` draws as.
 *
 * A declared target opens its first declaration, which the backend orders per
 * ADR-0028. While the index is absent or building, a target outside the file is a chip
 * whose click warms the index. A target the ready index does not hold is text.
 */
export function decideObjectLink(hash: string, targets: LinkTargets): LinkDecision {
  const declared = targets.declared.get(hash);
  if (declared) {
    const [first] = declared.declarations;
    if (!first) return TEXT;
    return {
      kind: "chip",
      document: objectDocument(first.asset, hash, declared.path, first.file, first.class),
    };
  }
  const status = targets.index?.status;
  if (status === "ready" || status === "failed") return TEXT;
  if (status === "building" || status === "absent") return WARM;
  return targets.pending ? PENDING : TEXT;
}

/** The asset declaring object `hash`, where one other than `asset` declares it. */
export function declaredElsewhere(
  hash: string,
  targets: LinkTargets,
  asset: AssetRef,
): AssetRef | null {
  const decision = decideObjectLink(hash, targets);
  if (decision.kind !== "chip" || decision.document.kind !== "object") return null;
  const declaring = decision.document.asset;
  return assetKey(declaring) === assetKey(asset) ? null : declaring;
}

/** What a `Hash` draws as: a chip where the index declares an object under it, else text. */
export function decideHash(hash: string, targets: LinkTargets): LinkDecision {
  const declared = targets.declared.get(hash);
  const [first] = declared?.declarations ?? [];
  if (!declared || !first) return TEXT;
  return {
    kind: "chip",
    document: objectDocument(first.asset, hash, declared.path, first.file, first.class),
  };
}

/**
 * What a `WadChunkLink` draws as.
 *
 * The layer's copy answers first and the install's second, and the chip carries the
 * side that answered. A path nothing resolves is text. A path both sides lack is
 * missing, which is a chunk the file names and nothing on this machine holds.
 */
export function decideFileLink(
  path: string | null,
  targets: LinkTargets,
  layer: LayerCopy | null,
): FileLinkDecision {
  if (path === null) return TEXT;
  if (layer) {
    return { kind: "chip", document: previewDocument(layer.asset, path), side: layer.title };
  }
  const located = targets.located.get(path);
  if (located) {
    const asset = { kind: "gameChunk", wad: located.wad, pathHash: located.pathHash } as const;
    return { kind: "chip", document: previewDocument(asset, path), side: assetContext(asset) };
  }
  return targets.pending ? PENDING : MISSING;
}

/**
 * The chunk path a `string` names, or null where it names none.
 *
 * An `ASSETS/` or `DATA/` prefix in any case, and an extension. Lowercased as the
 * tables spell it, which is the one spelling the resolver, the layer and the preview
 * all answer under.
 */
export function chunkPath(text: string): string | null {
  const path = text.toLowerCase();
  if (!path.startsWith("assets/") && !path.startsWith("data/")) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 1 || dot === name.length - 1) return null;
  return path;
}

/**
 * What a `string` draws as, per "A string that names a thing" in docs/ux/BIN_EDITOR.md.
 *
 * A path the resolver holds takes the chunk, and any other string takes the object its
 * hash declares. One that answers on both sides takes the chunk.
 */
export function decideStringLink(
  text: string,
  targets: LinkTargets,
  layer: (path: string) => LayerCopy | null,
): LinkDecision | MissingChunk {
  const path = chunkPath(text);
  if (path !== null) {
    const chunk = decideFileLink(path, targets, layer(path));
    if (chunk.kind === "chip") return chunk;
    /* A path-shaped string the index also declares is that object, not a lost chunk. */
    const declared = decideHash(nameHash(text), targets);
    return declared.kind === "chip" ? declared : chunk;
  }
  return decideHash(nameHash(text), targets);
}

/** The decision for any row value, or null for a value that is no link. */
export function decideLink(
  value: BinValue,
  targets: LinkTargets,
  layer: (path: string) => LayerCopy | null,
): LinkDecision | MissingChunk | null {
  switch (value.type) {
    case "objectLink":
      return decideObjectLink(value.hash, targets);
    case "hash":
      return decideHash(value.hash, targets);
    case "wadChunkLink":
      return decideFileLink(value.path, targets, value.path === null ? null : layer(value.path));
    case "string":
      return decideStringLink(value.value, targets, layer);
    default:
      return null;
  }
}
