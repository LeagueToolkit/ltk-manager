import { use } from "react";

import { Checkbox } from "@/components";
import { m } from "@/i18n";
import type { BinRow, FieldSchema } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { FieldRow } from "../../../classes/components/ClassCells";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import { emitterPlace } from "../../clipboard/emitterCopy";
import { holderRow } from "../../drivers/utils/holderRow";
import { cycleEdits, noCycleEdits } from "../../timeline/utils/timingEdits";
import type { InspectorProperty } from "../utils/emitterGroups";
import { emitterLabel } from "../utils/emitterLabels";
import { CycleStrip } from "./CycleStrip";
import { DefaultProperty } from "./DefaultProperty";

interface PeriodPropertyProps {
  /** The `period` slot of the Emission group. */
  period: InspectorProperty;
  /** The `timeActiveDuringPeriod` slot, where the group lists it. */
  active: InspectorProperty | undefined;
  /** The emitter's own element row. */
  emitter: BinRow;
  owner: string | null;
  fields: readonly FieldSchema[] | undefined;
  width: string;
}

/**
 * The cycle of an emitter in the Emission group: a Repeats row, and under it the `period`
 * and `timeActiveDuringPeriod` rows while the emitter writes either.
 *
 * Repeats on gives the emitter a cycle of a second with half of it active, and off empties
 * both options, each as one undo step, so a cycle never leaves half of itself behind. The
 * row reads the cycle back as the timeline's bar does. "The emitter strip" in
 * docs/ux/BIN_EDITOR.md.
 */
export function PeriodProperty({
  period,
  active,
  emitter,
  owner,
  fields,
  width,
}: PeriodPropertyProps) {
  const editProperty = use(LeafEditContext)?.editProperty;
  const place = emitterPlace(emitter.path);
  const length = heldSeconds(period);
  const activeFor = heldSeconds(active);
  const repeats = length !== null;
  const editable = editProperty !== undefined && place !== null;

  function toggle(on: boolean) {
    if (editProperty === undefined || place === null) return;

    const edits = on ? cycleEdits(place.index, activeFor) : noCycleEdits(place.index, activeFor);
    void editProperty(holderRow(emitter.entry, ""), place.list, edits);
  }

  let reading: string;
  if (repeats) {
    reading = m.workshop_bin_timeline_bar_period_label({
      length: plain(length),
      active: plain(activeFor ?? length),
    });
  } else if (activeFor !== null) {
    reading = m.workshop_bin_timeline_bar_active_label({ active: plain(activeFor) });
  } else {
    reading = m.workshop_bin_inspector_no_cycle_label();
  }

  return (
    <>
      {/* The same frame as a field row in a table layout, so the line reads as one of them. */}
      <div
        data-ui="PeriodProperty"
        className="group/row relative flex min-h-6 items-center px-1.5 hover:bg-surface-veil-soft"
      >
        <span className={twMerge("flex min-w-0 shrink-0 items-center", width)}>
          <span aria-hidden className="h-6 w-4 shrink-0" />
          <span className="truncate font-sans font-medium text-surface-200">
            {m.workshop_bin_inspector_repeats_label()}
          </span>
        </span>
        <div className="flex min-h-6 min-w-0 flex-1 items-center gap-2 border-l border-surface-700/40 pl-2">
          <Checkbox
            size="sm"
            checked={repeats}
            disabled={!editable}
            aria-label={m.workshop_bin_timeline_repeats_action()}
            onCheckedChange={toggle}
          />
          {repeats && <CycleStrip period={{ length, active: activeFor }} />}
          <span
            className={twMerge(
              "min-w-0 truncate font-sans text-meta text-surface-400 tabular-nums select-none",
              !repeats && activeFor === null && "italic",
            )}
          >
            {reading}
          </span>
        </div>
      </div>
      {(repeats || activeFor !== null) && (
        <>
          <TimingRow
            property={period}
            emitter={emitter}
            owner={owner}
            fields={fields}
            width={width}
          />
          {active !== undefined && (
            <TimingRow
              property={active}
              emitter={emitter}
              owner={owner}
              fields={fields}
              width={width}
            />
          )}
        </>
      )}
    </>
  );
}

/** The seconds an `Option<f32>` slot holds, or null for an empty option and for a default. */
function heldSeconds(property: InspectorProperty | undefined): number | null {
  if (property === undefined || !("row" in property)) return null;
  return property.row.value.type === "float" ? property.row.value.value : null;
}

/** `value` as text, with at most two decimals and no trailing zeroes. */
function plain(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** One of the two timing rows, as the group draws an `Option<f32>` row: at its default, empty, or held. */
function TimingRow({
  property,
  emitter,
  owner,
  fields,
  width,
}: {
  property: InspectorProperty;
  emitter: BinRow;
  owner: string | null;
  fields: readonly FieldSchema[] | undefined;
  width: string;
}) {
  const definition = fields?.find((field) => field.hash === property.hash);
  if ("field" in property) {
    return (
      <DefaultProperty
        field={property.field}
        holder={emitter}
        width={width}
        owner={owner}
        depth={1}
      />
    );
  }

  const { row } = property;
  if (
    row.value.type === "optional" &&
    definition?.declared?.kind === "option" &&
    definition.declared.value === "f32" &&
    !row.declared?.mismatch
  ) {
    return (
      <DefaultProperty
        field={{ ...definition, name: definition.name ?? row.name }}
        holder={emitter}
        authored={row}
        width={width}
        owner={owner}
        depth={1}
      />
    );
  }

  return (
    <FieldRow
      row={row}
      label={emitterLabel(property.hash, row.name)}
      tableLayout
      width={width}
      owner={owner}
      depth={1}
    />
  );
}
