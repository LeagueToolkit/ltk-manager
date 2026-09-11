import { useMemo } from "react";

import type { BinDocumentId, BinRow, BinRows } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { childCount, fieldHash, rowKey } from "./binRows";
import { fieldsIn, type LayoutPages } from "./ClassCells";
import type { PlacedSection } from "./classLayouts";
import { CARD, type EmitterGroup, groupRows } from "./emitterGroups";
import type { ChildChoice, Chosen, EmitterCardData } from "./emitterTypes";
import { type ReadRequest, useBinRead } from "./useBinRead";

/** The second list, whose cards are marked, since one strip holds both. */
const SIMPLE_LIST = nameHash("simpleEmitterDefinitionData");

const COMPLEX_LIST = nameHash("complexEmitterDefinitionData");

export const NO_CARDS: readonly EmitterCardData[] = [];

/**
 * The cards whose name holds `filter`, case-insensitively, or every card for no filter.
 *
 * The name rather than the index, because a reader typing here is looking for an emitter
 * they can name and the index is what the card already shows beside it.
 */
export function matching(
  cards: readonly EmitterCardData[],
  filter: string,
): readonly EmitterCardData[] {
  const wanted = filter.trim().toLowerCase();
  if (wanted === "") return cards;
  return cards.filter((card) => nameOf(card).toLowerCase().includes(wanted));
}

export function cardsOf(section: PlacedSection, pages: LayoutPages): EmitterCardData[] {
  return section.rows.flatMap((container) => {
    const simple = fieldHash(container.path) === SIMPLE_LIST;
    const elements = pages.get(rowKey(container))?.rows ?? [];
    return elements.map((row, index) =>
      cardOf(row, index, simple, pages.get(rowKey(row))?.rows ?? []),
    );
  });
}

function cardOf(
  row: BinRow,
  index: number,
  simple: boolean,
  fields: readonly BinRow[],
): EmitterCardData {
  return {
    row,
    key: rowKey(row),
    index,
    simple,
    fields: fieldsIn(fields),
    groups: groupRows(fields),
  };
}

/** The first group card `key` sets, and none for a card whose fields have not landed. */
export function firstGroup(cards: readonly EmitterCardData[], key: string): EmitterGroup | null {
  return cards.find((each) => each.key === key)?.groups[0]?.group ?? null;
}

/**
 * The child emitter a lane selected, read as a card through the open's own handle.
 *
 * A child system is an object of the open document, since the resolver inlines no other.
 * The card is held on the two answers, so it keeps its identity between renders.
 */
export function useChildCard(
  document: BinDocumentId,
  child: ChildChoice | null,
): EmitterCardData | undefined {
  const listReads = useMemo(() => childListReads(child), [child]);
  const list = useBinRead(document, listReads).get(listReads[0]?.key ?? "");
  const fieldReads = useMemo(() => childFieldReads(child, list), [child, list]);
  const fields = useBinRead(document, fieldReads).get(fieldReads[0]?.key ?? "");
  return useMemo(() => childCardOf(child, list, fields), [child, list, fields]);
}

/** The wire path of the list a child emitter sits in. */
function childListPath(child: ChildChoice): string {
  return (child.emitter.simple ? SIMPLE_LIST : COMPLEX_LIST).slice(2);
}

/** The read of the list a child emitter sits in, and none for a child whose entry is unknown. */
export function childListReads(child: ChildChoice | null): ReadRequest[] {
  if (child === null || child.system.entry === null) return [];
  const listed = child.system.emitters.filter((each) => each.simple === child.emitter.simple);
  const key = rowKey({ entry: child.system.entry, path: childListPath(child) });
  return [{ key, rows: Math.max(listed.length, child.emitter.listIndex + 1) }];
}

/** The read of the child emitter's own fields, once its list has answered. */
export function childFieldReads(
  child: ChildChoice | null,
  list: BinRows | undefined,
): ReadRequest[] {
  const element = childElement(child, list);
  if (element === undefined) return [];
  return [{ key: rowKey(element), rows: childCount(element) }];
}

/** The child emitter as a card, once its list and its fields have both answered. */
export function childCardOf(
  child: ChildChoice | null,
  list: BinRows | undefined,
  fields: BinRows | undefined,
): EmitterCardData | undefined {
  const element = childElement(child, list);
  if (child === null || element === undefined || fields === undefined) return undefined;
  return cardOf(element, child.emitter.listIndex, child.emitter.simple, fields.rows);
}

/** The child emitter's own element row, out of its list's answer. */
function childElement(child: ChildChoice | null, list: BinRows | undefined): BinRow | undefined {
  if (child === null) return undefined;
  const path = `${childListPath(child)}[${child.emitter.listIndex}]`;
  return list?.rows.find((row) => row.path === path);
}

/** The chosen card and group, falling back to the first emitter's first group. */
export function openOf(chosen: Chosen | null, cards: readonly EmitterCardData[]): Chosen | null {
  if (chosen !== null && cards.some((each) => each.key === chosen.key)) return chosen;
  const [first] = cards;
  const group = first?.groups[0];
  if (first === undefined || group === undefined) return null;
  return { key: first.key, group: group.group };
}

/** The emitter's own `emitterName`, else the name its element row carries. */
export function nameOf(card: EmitterCardData): string {
  const name = card.fields(CARD.name);
  return name?.value.type === "string" ? name.value.value : card.row.name;
}

/** The emitter as a curve caption's chain opens on it: its name and its index. */
export function emitterChain(card: EmitterCardData): string {
  return `${nameOf(card)} [${card.index}]`;
}

/** The chain a curve caption reads for `row`, one of the emitter's own fields. */
export function fieldChain(card: EmitterCardData, row: BinRow): string {
  return `${emitterChain(card)} . ${row.name}`;
}

/** Every field the emitter sets, across its groups. */
export function emitterRows(card: EmitterCardData): BinRow[] {
  return card.groups.flatMap((each) => each.rows);
}
