import { use, useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api } from "@/lib/tauri";

import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import { type EmitterPlace, emitterPlace } from "../../clipboard/emitterCopy";
import { holderRow } from "../../drivers/utils/holderRow";
import type { EmitterModel } from "../../engine/model/model";
import type { EmitterCardData } from "../../inspector/utils/emitterTypes";
import { useVfxRun } from "../../playback/state/run";
import { barFields, type BarGrip, followedBar } from "../utils/barDrag";
import { type LaneBar, laneBar } from "../utils/laneModel";
import { draggedEdits, seconds, timingEdits, withBar } from "../utils/timingEdits";

/** The least time between two previews of a drag, in milliseconds, since each replays the run. */
const PREVIEW_MS = 80;

/** One emitter that a drag changes, its place in its list, and the bar the drag gives it. */
interface Moved {
  readonly emitter: EmitterModel;
  readonly place: EmitterPlace;
  readonly bar: LaneBar;
}

/** The bars that the other selected lanes draw during a drag, by pool index. Null clears them. */
export type FollowBars = (bars: ReadonlyMap<number, LaneBar> | null) => void;

/** The timeline's selection: every card of the system, and the keys of the selected ones. */
export interface LaneSelection {
  readonly cards: readonly EmitterCardData[];
  readonly selected: ReadonlySet<string>;
}

/**
 * What an emitter's lane edits its bar with: the write a drag ends in, the preview it runs,
 * and the exact times a double click opens. Every callback is undefined for a lane that
 * takes no edit.
 *
 * A drag on a lane of a timeline selection of several lanes changes every selected bar by the
 * same seconds, per `followedBar`, and hands the other bars to `onFollow` on every move. The
 * write puts every field of one drag in one edit, one undo step. The preview swaps the dragged
 * timing into the run and replays it to the playhead, at most every `PREVIEW_MS`, and a dropped
 * drag swaps the run's own system back.
 */
export function useBarEditing(
  emitter: EmitterModel,
  card: EmitterCardData | undefined,
  { cards, selected }: LaneSelection,
  onFollow: FollowBars,
) {
  const run = useVfxRun();
  const edit = use(LeafEditContext);
  const toast = useToast();
  const [opened, setOpened] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const place = card === undefined ? null : emitterPlace(card.row.path);

  const waiting = useRef<readonly Moved[] | null | undefined>(undefined);
  const timer = useRef<number | null>(null);
  const shown = useRef(0);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const editProperty = edit?.editProperty;
  if (card === undefined || place === null || editProperty === undefined) {
    return { editor: null, onBarEdit: undefined, onBarPreview: undefined, onBarOpen: undefined };
  }

  /* The lane's own emitter first, then each other selected emitter that has the dragged edge. */
  const movedBy = (grip: BarGrip | undefined, bar: LaneBar): Moved[] => {
    const own = { emitter, place, bar };
    const { system } = run;
    if (grip === undefined || system === null || !selected.has(card.key)) return [own];

    const held = laneBar(emitter);
    const others = cards.flatMap((each): Moved[] => {
      if (each.key === card.key || !selected.has(each.key)) return [];

      const other = system.emitters.find(
        (candidate) => candidate.simple === each.simple && candidate.listIndex === each.index,
      );
      const otherPlace = emitterPlace(each.row.path);
      if (other === undefined || otherPlace === null) return [];

      const followed = followedBar(grip, held, bar, laneBar(other), !other.simple);
      return followed === null ? [] : [{ emitter: other, place: otherPlace, bar: followed }];
    });
    return [own, ...others];
  };

  const show = (moved: readonly Moved[] | null) => {
    const { driver, system } = run;
    if (system === null) return;

    const bars = new Map(moved?.map((each) => [each.emitter.index, each.bar]));
    const next = {
      ...system,
      emitters: system.emitters.map((each) => {
        const bar = bars.get(each.index);
        return bar === undefined ? each : withBar(each, bar);
      }),
    };
    driver.swap(moved === null ? system : next);
    driver.seek(driver.phase);
    shown.current = performance.now();
  };
  const onBarPreview = (bar: LaneBar | null, grip?: BarGrip) => {
    const moved = bar === null ? null : movedBy(grip, bar);
    if (moved === null || moved.length > 1) {
      onFollow(moved && new Map(moved.slice(1).map((each) => [each.emitter.index, each.bar])));
    }

    waiting.current = moved;
    if (timer.current !== null) return;

    const wait = Math.max(PREVIEW_MS - (performance.now() - shown.current), 0);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const held = waiting.current;
      waiting.current = undefined;
      if (held !== undefined) show(held);
    }, wait);
  };

  const onBarEdit = async (grip: BarGrip, bar: LaneBar) => {
    const moved = movedBy(grip, bar);
    const send = edit?.send;
    const landed = edit?.landed;
    if (moved.length === 1 || send === undefined || landed === undefined) {
      return editProperty(
        holderRow(card.row.entry, ""),
        place.list,
        timingEdits(
          place.index,
          barFields(grip, bar).map(({ field, value }) => ({ field, value: seconds(value) })),
        ),
      );
    }

    const edits = draggedEdits(card.row.entry, grip, moved);
    const { result, id } = await send((at) => api.bin.edit(at, { kind: "editProperties", edits }));
    if (!result.ok) {
      toast.failure(m.workshop_bin_edit_refused_title(), result.error);
      return false;
    }

    landed(id);
    return true;
  };

  return {
    editor: { row: card.row, at: opened, onClose: () => setOpened(null) },
    onBarEdit,
    onBarPreview,
    onBarOpen: setOpened,
  };
}
