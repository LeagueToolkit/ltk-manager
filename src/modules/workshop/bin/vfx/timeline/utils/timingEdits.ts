import type { LeafValue, PropertyEdit, ValueEdit } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import type { EmitterPlace } from "../../clipboard/emitterCopy";
import type { EmitterModel } from "../../engine/model/model";
import { barFields, type BarGrip } from "./barDrag";
import type { LaneBar } from "./laneModel";

/** The emitter fields the timeline writes, by name. */
export const TIMING = {
  timeBeforeFirstEmission: nameHash("timeBeforeFirstEmission"),
  lifetime: nameHash("lifetime"),
  particleLinger: nameHash("particleLinger"),
  period: nameHash("period"),
  timeActiveDuringPeriod: nameHash("timeActiveDuringPeriod"),
  isSingleParticle: nameHash("isSingleParticle"),
  emitterLinger: nameHash("emitterLinger"),
  particleLingerType: nameHash("particleLingerType"),
  HasVariableStartTime: nameHash("HasVariableStartTime"),
} as const;

export type TimingName = keyof typeof TIMING;

/**
 * The edits that write `values` onto the emitter at `index` of its list, all under the list's
 * one property, so a drag that moves two fields is one undo step. A field the emitter lacks
 * is added first.
 */
export function timingEdits(
  index: number,
  values: readonly { readonly field: TimingName; readonly value: LeafValue }[],
): ValueEdit[] {
  const item = `[${index}]`;
  return values.flatMap(({ field, value }): ValueEdit[] => [
    { type: "ensureProperty", path: item, field: TIMING[field] },
    { type: "setLeaf", path: `${item}.${TIMING[field].slice(2)}`, value },
  ]);
}

/**
 * Returns the edits that write the fields a drag of `grip` sets on each bar of `moved`, one per
 * emitter list of the system `entry`, so the drag of several bars is one undo step.
 */
export function draggedEdits(
  entry: string,
  grip: BarGrip,
  moved: readonly { readonly place: EmitterPlace; readonly bar: LaneBar }[],
): PropertyEdit[] {
  const lists = new Map<string, ValueEdit[]>();
  for (const { place, bar } of moved) {
    const values = barFields(grip, bar).map(({ field, value }) => ({
      field,
      value: seconds(value),
    }));
    lists.set(place.list, [...(lists.get(place.list) ?? []), ...timingEdits(place.index, values)]);
  }

  return [...lists].map(([field, edits]) => ({ entry, holder: "", field, edits }));
}

/**
 * The edits that empty each optional of `fields` on the emitter at `index`, which then read
 * unset, as one undo step. A field the emitter leaves empty is not in `fields`, since the
 * edit of an empty option is refused.
 */
export function clearedEdits(index: number, fields: readonly TimingName[]): ValueEdit[] {
  return fields.map((field) => ({
    type: "removeItem",
    path: `[${index}].${TIMING[field].slice(2)}[0]`,
  }));
}

/** The cycle a fresh `period` writes, in seconds, with its active part half of it. */
export const DEFAULT_CYCLE = { length: 1, active: 0.5 } as const;

/**
 * The edits that give the emitter at `index` a cycle: `DEFAULT_CYCLE`'s length, and its
 * active part where `active` is null, as one undo step. An active part the emitter holds
 * that is past the length stays, and the length grows to it so the cycle still pauses.
 */
export function cycleEdits(index: number, active: number | null): ValueEdit[] {
  const length =
    active === null ? DEFAULT_CYCLE.length : Math.max(DEFAULT_CYCLE.length, active * 2);
  const values: { field: TimingName; value: LeafValue }[] = [
    { field: "period", value: seconds(length) },
  ];
  if (active === null) {
    values.push({ field: "timeActiveDuringPeriod", value: seconds(DEFAULT_CYCLE.active) });
  }

  return timingEdits(index, values);
}

/** The edits that take the cycle off the emitter at `index`: its length, and its active part where it holds one. */
export function noCycleEdits(index: number, active: number | null): ValueEdit[] {
  return clearedEdits(index, active === null ? ["period"] : ["period", "timeActiveDuringPeriod"]);
}

export function seconds(value: number): LeafValue {
  return { type: "float", value };
}

/** `emitter` with the timing `bar` draws, for the preview a drag runs. */
export function withBar(emitter: EmitterModel, bar: LaneBar): EmitterModel {
  return {
    ...emitter,
    timeBeforeFirstEmission: bar.start,
    lifetime: bar.end,
    particleLinger: bar.linger,
  };
}
