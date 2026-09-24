import type { ReactNode } from "react";

import type { ContentDocument } from "../../documents";
import type { MatchRange } from "./matcher";

/** The sources whose rows the frontend matches, from candidates built for them. */
export type LocalSourceId =
  | "projects"
  | "documents"
  | "files"
  | "layers"
  | "strings"
  | "commands"
  | "settings"
  | "projectObjects";

/**
 * The sources whose rows arrive from the backend already ranked and grouped.
 *
 * `PALETTE_SOURCES` flags each of these too, and the compiler holds the two to one answer.
 */
export type BackendRankedSourceId = "game" | "objects" | "rows";

/** Where a palette row came from, which is also the group it lands in. */
export type PaletteSourceId = LocalSourceId | BackendRankedSourceId;

/**
 * One action the project bar can run.
 *
 * The module that owns the action owns the record, so a command closes over the
 * real mutation rather than over a copy of it.
 */
export interface ProjectCommand {
  id: string;
  title: string;
  group: string;
  /** Words a user might type that the title does not hold. */
  keywords?: readonly string[];
  shortcut?: string;
  /** False greys the row. A pack with no layers cannot run. */
  enabled?: boolean;
  /** What the greyed row says in place of its shortcut. */
  disabledReason?: string;
  icon?: ReactNode;
  run: () => void;
}

/**
 * What a row does once it is chosen.
 *
 * A layer file names its layer and path rather than carrying a built document,
 * because a project of a few thousand files builds one of these per file.
 */
export type PaletteTarget =
  | {
      readonly kind: "project";
      /** The id the route takes, derived from the project's path. */
      readonly id: string;
    }
  | { readonly kind: "layerFile"; readonly layerName: string; readonly path: string }
  | {
      readonly kind: "gameChunk";
      readonly wad: string;
      readonly pathHash: string;
      /** The resolved path, or empty for a chunk no hash table names. */
      readonly path: string;
    }
  | {
      /** A bin object of the install, opened as an object tab over the chunk that declares it. */
      readonly kind: "object";
      readonly wad: string;
      readonly pathHash: string;
      /** The declaring chunk's path, or empty for a chunk no hash table names. */
      readonly path: string;
      /** `0x` and eight hex digits. */
      readonly objectHash: string;
      /** The object's path, or its hash when no table names it. */
      readonly objectPath: string;
      /** The class the object declares, for the tab's mark. */
      readonly objectClass?: string;
    }
  | {
      /** A bin object of the project, opened as an object tab over the layer file that declares it. */
      readonly kind: "layerObject";
      readonly layerName: string;
      readonly path: string;
      /** `0x` and eight hex digits. */
      readonly objectHash: string;
      /** The object's path, or its hash when no table names it. */
      readonly objectPath: string;
      /** The class the object declares, for the tab's mark. */
      readonly objectClass?: string;
    }
  | { readonly kind: "document"; readonly document: ContentDocument }
  | {
      /** A row of the tab the bar was opened over, which the tab expands down to and scrolls to. */
      readonly kind: "row";
      readonly documentId: string;
      /** The row's key: its object's hash, a colon, and its wire path. */
      readonly key: string;
    }
  | { readonly kind: "command"; readonly command: ProjectCommand }
  | { readonly kind: "prefix"; readonly prefix: string }
  | {
      /** Text put into the box in place of what is there, with the palette kept open. */
      readonly kind: "query";
      readonly query: string;
      /** The source the box scopes to first, where the text belongs under one. */
      readonly scope?: PaletteSourceId;
    };

/** One row of the list, whoever ranked it. */
export interface PaletteRowData {
  readonly id: string;
  readonly source: PaletteSourceId;
  /** The row's title, and what the query is matched against first. */
  readonly name: string;
  /** The dim line under the name. Empty for a row that names no location. */
  readonly path: string;
  /** The trailing edge of the row: the layer that holds it, or a shortcut. */
  readonly trailing?: string;
  /** The layer this row belongs to, so the open one can rank above the rest. */
  readonly layerName?: string;
  /**
   * The tab this row opens, which is what the navigation history names it by.
   *
   * Held apart from `id`, because a file and the tab showing that file are two
   * rows of two sources and cannot share one key.
   */
  readonly documentId?: string;
  /** Greys the row and stops it running. */
  readonly disabled?: boolean;
  readonly icon: ReactNode;
  readonly target: PaletteTarget;
}

/**
 * A row the frontend matches, with everything the matcher needs precomputed.
 *
 * `nameLower`, `fullLower` and `mask` are built once with the array. Lowercasing
 * a few thousand rows per keystroke is the cost that shows up in a scan, and
 * this is what removes it. A backend-ranked source's rows arrive already ranked
 * and so carry none of it.
 */
export interface PaletteCandidate extends PaletteRowData {
  /**
   * Words a user might type that neither the name nor the path holds.
   *
   * Lowercased and joined at build. A match here marks nothing, because the
   * words it matched are not on screen.
   */
  readonly keywords?: string;
  /**
   * Where the last `/` segment of `name` starts, for a name that is a whole object path.
   *
   * That segment takes the band a file name takes, and the rest of the path the
   * band a directory takes. `path` is then a description rather than a location,
   * and no match reads it.
   */
  readonly nameCut?: number;
  /** The class an object row declares, which a `class:` term narrows on. */
  readonly objectClass?: { readonly name: string; readonly hash: string };
  readonly nameLower: string;
  /** `path/name`, which is what a match reaching the directory is scored on. */
  readonly fullLower: string;
  readonly mask: number;
}

/**
 * What each locally-matched source contributes, source by source.
 *
 * Partial because a context holds only the sources it has: the workshop's own
 * surface carries commands and no files. A backend-ranked source is absent from
 * every one of them, because its rows reach the bar already grouped, as
 * [`BackendRankedGroups`].
 */
export type PaletteCandidates = Partial<
  Readonly<Record<LocalSourceId, readonly PaletteCandidate[]>>
>;

/** A row that matched, with what it marks and how it sorts against its group. */
export interface RankedRow {
  readonly row: PaletteRowData;
  /** 0 is a name the query opens, 1 a name holding it, 2 a match reaching the directory. */
  readonly band: number;
  readonly score: number;
  readonly nameRanges: readonly MatchRange[];
  readonly pathRanges: readonly MatchRange[];
}

/** One source's matched rows, capped, with the total it was capped from. */
export interface PaletteGroup {
  readonly source: PaletteSourceId;
  readonly label: string;
  readonly rows: readonly RankedRow[];
  /** How many matched in all, which the header shows and the cap trimmed. */
  readonly total: number;
  /** A fresh answer is on its way, so what is here is the last one. */
  readonly pending?: boolean;
}

/**
 * What each backend-ranked source contributes, already grouped, source by source.
 *
 * Partial for the same reason [`PaletteCandidates`] is, and null for a source
 * the context reads that has nothing to say to this query.
 */
export type BackendRankedGroups = Partial<
  Readonly<Record<BackendRankedSourceId, PaletteGroup | null>>
>;

/** How `Enter` and its modifiers ask for a row to open. */
export type OpenIntent = "default" | "beside" | "permanent";
