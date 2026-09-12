import type { BinRow } from "@/lib/tauri";

import type { FieldsOf } from "./ClassCells";
import type { EmitterGroup, GroupedRows } from "./emitterGroups";
import type { EmitterModel, SystemModel } from "./vfx/model";

/** Which of the two readings of the emitter lists is drawn. */
export type EmitterMode = "cards" | "table";

/** What the inspector draws, which is the crumb segment last aimed at. */
export type InspectorTarget = "system" | "emitter";

/** A child system's emitter a lane selected, which the inspector draws in place of the card. */
export interface ChildChoice {
  /** The child definition's path under the opened system, `3.0` for the first child of emitter 3. */
  readonly path: string;
  /** The key of the card whose emitter carries the child, null where no card is drawn for it. */
  readonly parent: string | null;
  readonly system: SystemModel;
  readonly emitter: EmitterModel;
}

/** One emitter of one of the two lists, with the groups its own fields fall into. */
export interface EmitterCardData {
  readonly row: BinRow;
  readonly key: string;
  /** Its place in its own list, which is the index the wire path addresses it by. */
  readonly index: number;
  readonly simple: boolean;
  readonly fields: FieldsOf;
  readonly groups: readonly GroupedRows[];
}

/** Which card is open, and at which of its groups. Null while its fields have not landed. */
export interface Chosen {
  readonly key: string;
  readonly group: EmitterGroup | null;
}

/**
 * How much of one section of the inspector is worth reading.
 *
 * "Where a curve is drawn small" in docs/ux/BIN_EDITOR.md: what is not drawn is not read.
 */
export interface SectionRead {
  /** The section is unfolded, so its rows draw and their constants are read. */
  readonly drawn: boolean;
  /** The section is on screen too, so its rows draw the shape of their curves. */
  readonly seen: boolean;
}

/** A section that has reported nothing draws and shows, which is a host with no observer. */
export const SECTION_SHOWN: SectionRead = { drawn: true, seen: true };

/** A section the reader folded, whose rows the inspector neither draws nor reads. */
export const SECTION_FOLDED: SectionRead = { drawn: false, seen: false };
