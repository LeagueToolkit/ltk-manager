import { createContext, use, useCallback, useMemo, useState } from "react";

import type { BinDocumentId, BinRow } from "@/lib/tauri";

import type { LayoutPages } from "./ClassCells";
import type { LayoutFrame, PlacedSection } from "./classLayouts";
import { cardsOf, firstGroup, matching, NO_CARDS, openOf, useChildCard } from "./emitterCards";
import { CARD, type EmitterGroup, type GroupedRows } from "./emitterGroups";
import {
  type ChildChoice,
  type Chosen,
  type EmitterCardData,
  type EmitterMode,
  type InspectorTarget,
  SECTION_SHOWN,
  type SectionRead,
} from "./emitterTypes";
import { useValueMarks } from "./useValueMarks";
import type { CurveRead, ValueMark } from "./valueRows";

const NO_SECTIONS: ReadonlyMap<EmitterGroup, SectionRead> = new Map();

/** What every drawn row is read for: the mark alone, which a section on screen reads past. */
const DRAWN_READ: CurveRead = "bands";

/**
 * The reading, the open card, and the rows the strip marks.
 *
 * The frame holds it rather than the section, because a stack draws the panel under the
 * strip and a shell draws it in the column beside, so a fall from one to the other
 * remounts the section and would lose the reader's place with it.
 */
export interface EmitterChoice {
  /** The cards the filter left, which is every card while nothing is typed. */
  readonly cards: readonly EmitterCardData[];
  /** How many the section holds, for the line saying how many of them are drawn. */
  readonly total: number;
  /** What the reader typed, which narrows both readings at once. */
  readonly filter: string;
  readonly setFilter: (filter: string) => void;
  /** The emitter the inspector draws: the child a lane selected, else the open card. */
  readonly card: EmitterCardData | undefined;
  /** The opened system's own open card, which is the child's parent while one is selected. */
  readonly root: EmitterCardData | undefined;
  /** Which of the opened system's cards is open, and at which of its groups. */
  readonly rootOpen: Chosen | null;
  /** The group the crumb names: the one the inspector has in view, else the one last aimed at. */
  readonly group: EmitterGroup | null;
  /** Which emitter the inspector draws, and at which of its groups. */
  readonly open: Chosen | null;
  /** Bumped per aim at a group, which the inspector answers with a scroll. */
  readonly jumpRequest: number;
  readonly target: InspectorTarget;
  /** The child lane selected, until a card of the opened system is. */
  readonly child: ChildChoice | null;
  /** The groups the inspector draws: every one the card sets, or the one a group tab names. */
  readonly shown: readonly GroupedRows[];
  /** Draw one of the crumb segments, which is what clicking that segment does. */
  readonly aim: (target: InspectorTarget) => void;
  /** Open a card, which its name row does and which aims the crumb middle segment. */
  readonly chooseCard: (key: string) => void;
  /** Open one group of a card, which a chip does and which aims the last segment. */
  readonly chooseGroup: (chosen: Chosen) => void;
  /** Select a child lane, which draws the child's emitter and opens its parent's card. */
  readonly chooseChild: (child: ChildChoice) => void;
  readonly mode: EmitterMode;
  readonly setMode: (mode: EmitterMode) => void;
  /** The squares colours and the rows the inspector draws, the only families it marks. */
  readonly marked: readonly BinRow[];
  /** What those rows are read for, which is the mark alone. A section on screen asks for more. */
  readonly read: CurveRead;
  /** The rows of the sections on screen, which are the only ones read for a curve. */
  readonly spark: readonly BinRow[];
  /** A section says how much of it is worth reading, which is what bounds the read. */
  readonly report: (group: EmitterGroup, read: SectionRead) => void;
  /** The inspector of card `key` says which group it has in view, null before it measures. */
  readonly reportInView: (key: string, group: EmitterGroup | null) => void;
  /** The struct and list rows held open, by their path under the emitter, on every emitter. */
  readonly openRows: ReadonlySet<string>;
  readonly toggleRow: (path: string) => void;
}

const NO_GROUPS: readonly GroupedRows[] = [];
const NO_MARKED: readonly BinRow[] = [];
const NO_OPEN_ROWS: ReadonlySet<string> = new Set();

const NO_EMITTERS: EmitterChoice = {
  cards: NO_CARDS,
  total: 0,
  filter: "",
  setFilter: () => {},
  card: undefined,
  root: undefined,
  rootOpen: null,
  group: null,
  open: null,
  jumpRequest: 0,
  target: "emitter",
  child: null,
  shown: NO_GROUPS,
  aim: () => {},
  chooseCard: () => {},
  chooseGroup: () => {},
  chooseChild: () => {},
  mode: "cards",
  setMode: () => {},
  marked: NO_MARKED,
  read: "bands",
  spark: NO_MARKED,
  report: () => {},
  reportInView: () => {},
  openRows: NO_OPEN_ROWS,
  toggleRow: () => {},
};

/** What the frame chose, which both halves of the section read wherever it drew them. */
export const EmitterChoiceContext = createContext<EmitterChoice>(NO_EMITTERS);

/** What the frame chose, for the half of the section reading it. */
export function useEmitters(): EmitterChoice {
  return use(EmitterChoiceContext);
}

/** The section's own state, for the frame to hold above the two ways it draws it. */
export function useEmitterChoice(
  document: BinDocumentId,
  placed: readonly PlacedSection[],
  pages: LayoutPages,
  frame: LayoutFrame,
): EmitterChoice {
  const held = useMemo(() => {
    const section = placed.find((each) => each.widget === "emitters");
    return section === undefined ? NO_CARDS : cardsOf(section, pages);
  }, [placed, pages]);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [target, setTarget] = useState<InspectorTarget>("emitter");
  const [child, setChild] = useState<ChildChoice | null>(null);
  const [childChosen, setChildChosen] = useState<Chosen | null>(null);
  const childCard = useChildCard(document, child);
  const [mode, setMode] = useState<EmitterMode>("cards");
  const [filter, setFilter] = useState("");
  const [viewed, setViewed] = useState<Chosen | null>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
  const [openRows, setOpenRows] = useState(NO_OPEN_ROWS);
  const toggleRow = useCallback((path: string) => {
    setOpenRows((held) => {
      const next = new Set(held);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const cards = useMemo(() => matching(held, filter), [held, filter]);
  /* A child's parent is the card it names, and none while the filter or the read hides it. */
  const rootOpen = useMemo(() => {
    if (child === null) return openOf(chosen, cards);
    if (chosen === null || chosen.key !== child.parent) return null;
    return cards.some((each) => each.key === chosen.key) ? chosen : null;
  }, [child, chosen, cards]);
  const root = cards.find((each) => each.key === rootOpen?.key);
  const open = useMemo(
    () =>
      child === null
        ? rootOpen
        : openOf(childChosen, childCard === undefined ? NO_CARDS : [childCard]),
    [child, rootOpen, childChosen, childCard],
  );
  const card = child === null ? root : childCard;
  const inView = viewed !== null && viewed.key === card?.key ? viewed.group : null;
  const group = card === undefined ? null : (inView ?? open?.group ?? null);

  const reportInView = useCallback((key: string, next: EmitterGroup | null) => {
    setViewed((last) => (last?.key === key && last.group === next ? last : { key, group: next }));
  }, []);

  /* A group of the child's own card keeps the child, and a card of the system leaves it. */
  const childKey = childCard?.key;
  const chooseGroup = useCallback(
    (next: Chosen) => {
      if (next.key === childKey) {
        setChildChosen(next);
      } else {
        setChild(null);
        setChosen(next);
      }
      setTarget("group");
      setJumpRequest((count) => count + 1);
    },
    [childKey],
  );
  /* A card whose fields have not landed opens on no group rather than not opening. */
  const chooseCard = useCallback(
    (key: string) => {
      setChild(null);
      setChosen({ key, group: firstGroup(cards, key) });
      setTarget("emitter");
      setJumpRequest((count) => count + 1);
    },
    [cards],
  );
  const chooseChild = useCallback(
    (next: ChildChoice) => {
      const { parent } = next;
      setChild(next);
      setChildChosen(null);
      if (parent !== null) {
        setChosen((last) =>
          last?.key === parent ? last : { key: parent, group: firstGroup(cards, parent) },
        );
      }
      setTarget("emitter");
      setJumpRequest((count) => count + 1);
    },
    [cards],
  );

  const [sections, setSections] = useState(NO_SECTIONS);
  const report = useCallback((group: EmitterGroup, read: SectionRead) => {
    setSections((held) => {
      const own = held.get(group);
      if (own?.drawn === read.drawn && own.seen === read.seen) return held;
      return new Map(held).set(group, read);
    });
  }, []);

  /* A stack draws the panel under the strip, so its table takes the panel's place. A
     shell draws it in the column beside, where a table takes neither. */
  const drawn = frame === "shell" || mode === "cards";
  const focus = open?.group ?? null;
  const shown = useMemo(
    () => (drawn ? shownGroups(target, card, focus) : NO_GROUPS),
    [drawn, target, card, focus],
  );
  const marked = useMemo(
    () => [
      ...cards.flatMap((each) => {
        const colour = each.fields(CARD.colour);
        return colour === undefined ? [] : [colour];
      }),
      ...rowsOf(shown, sections, (read) => read.drawn),
    ],
    [cards, shown, sections],
  );

  const spark = useMemo(() => rowsOf(shown, sections, (each) => each.seen), [shown, sections]);

  return useMemo(
    () => ({
      cards,
      total: held.length,
      filter,
      setFilter,
      card,
      root,
      rootOpen,
      group,
      open,
      jumpRequest,
      target,
      child,
      shown,
      aim: setTarget,
      chooseCard,
      chooseGroup,
      chooseChild,
      mode,
      setMode,
      marked,
      read: DRAWN_READ,
      spark,
      report,
      reportInView,
      openRows,
      toggleRow,
    }),
    [
      cards,
      held.length,
      filter,
      card,
      root,
      rootOpen,
      group,
      open,
      jumpRequest,
      target,
      child,
      shown,
      chooseCard,
      chooseGroup,
      chooseChild,
      mode,
      marked,
      spark,
      report,
      reportInView,
      openRows,
      toggleRow,
    ],
  );
}

/** The rows of every shown group whose own report `wanted` accepts. */
function rowsOf(
  shown: readonly GroupedRows[],
  sections: ReadonlyMap<EmitterGroup, SectionRead>,
  wanted: (read: SectionRead) => boolean,
): BinRow[] {
  return shown
    .filter((each) => wanted(sections.get(each.group) ?? SECTION_SHOWN))
    .flatMap((each) => each.rows);
}

/**
 * What the strip's squares and the inspector's rows draw, each read as deep as it is drawn.
 *
 * "Where a curve is drawn small" in docs/ux/BIN_EDITOR.md. One read answers every drawn
 * row's mark and a second the keys of the sections on screen, so the two merge with the
 * deeper answer last.
 */
export function useEmitterMarks(
  document: BinDocumentId,
  emitters: EmitterChoice,
): ReadonlyMap<string, ValueMark> {
  const bands = useValueMarks(document, emitters.marked, emitters.read);
  const curves = useValueMarks(document, emitters.spark, "curves");
  return useMemo(() => new Map([...bands, ...curves]), [bands, curves]);
}

/**
 * The groups one target draws, which is what the inspector holds and what it marks.
 *
 * An emitter target draws every group it sets and a group target the one its tab names,
 * per "The inspector" in docs/ux/BIN_EDITOR.md.
 */
function shownGroups(
  target: InspectorTarget,
  card: EmitterCardData | undefined,
  group: EmitterGroup | null,
): readonly GroupedRows[] {
  if (target === "system" || card === undefined) return NO_GROUPS;
  if (target === "group") return card.groups.filter((each) => each.group === group);
  return card.groups;
}
