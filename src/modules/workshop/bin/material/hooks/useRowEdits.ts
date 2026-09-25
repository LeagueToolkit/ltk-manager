import { use, useState } from "react";

import { errorSummary, m } from "@/i18n";

import { type LeafEdit, LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import { type RowState, TableContext } from "../state/declaredTable";
import { baselineKey, useRowBaseline, useRowBaselineStore } from "../state/rowBaselines";
import type { DeclaredRow } from "../utils/declaredRows";
import { objectRow, setField } from "../utils/entryEdits";
import { revertFields, revertLabel, sameSnapshot, snapshotOf } from "../utils/rowSnapshot";
import { useEntryFields, useEntryRemove, useOverride } from "./useEntryEdits";

export interface RowEdits {
  readonly state: RowState;
  /** The edits the row's cells send, each recording the row's baseline before it goes. */
  readonly scoped: LeafEdit | null;
}

/**
 * The edits of one declared row: the baseline it held before its first edit, whether it still
 * holds it, the go-back and the shader-default actions, and what the last edit came to.
 *
 * Every edit a cell sends passes through `scoped`, so the baseline is taken whichever path
 * the edit comes by.
 */
export function useRowEdits<D>(row: DeclaredRow<D>): RowEdits {
  const table = use(TableContext);
  const edit = use(LeafEditContext);
  const removeEntry = useEntryRemove();
  const writeFields = useEntryFields();
  const override = useOverride();
  const record = useRowBaselineStore((store) => store.record);
  const [pulse, setPulse] = useState(0);
  const [failed, setFailed] = useState(false);

  const nameField = table?.kind.nameField ?? "";
  const key =
    table === null
      ? ""
      : baselineKey(table.view.document, table.view.entry, table.kind.list, row.name);
  const baseline = useRowBaseline(key);
  const current = table === null ? null : snapshotOf(row.element, table.pages);
  const changed = baseline !== undefined && current !== null && !sameSnapshot(baseline, current);

  const hold = () => {
    if (current !== null && key !== "") record(key, current);
  };
  const settle = (landed: boolean) => {
    setFailed(!landed);
    if (landed) setPulse((count) => count + 1);
  };
  const run = (send: () => Promise<boolean> | null) => {
    const sent = send();
    if (sent !== null) void sent.then(settle);
  };

  const editProperty = edit?.editProperty;
  const scoped: LeafEdit | null = edit && {
    ...edit,
    commit: async (target, typed) => {
      hold();
      const landed = (await edit.commit(target, typed)) !== false;
      settle(landed);
      return landed;
    },
    editProperty:
      editProperty &&
      (async (holder, field, edits) => {
        hold();
        const landed = await editProperty(holder, field, edits);
        settle(landed);
        return landed;
      }),
  };

  const element = row.element;
  const revert = (): Promise<boolean> | null => {
    if (baseline === undefined || current === null) return null;
    if (!baseline.present) {
      return element === null || removeEntry === null ? null : removeEntry(element);
    }
    if (element !== null) {
      return writeFields?.(element, revertFields(baseline, current, nameField)) ?? null;
    }

    const fields = [...baseline.fields].filter(([field]) => field !== nameField);
    return (
      override?.(row.name, (at) =>
        fields.flatMap(([field, value]) => setField(at, field, value)),
      ) ?? null
    );
  };

  let refusal: string | null = null;
  if (failed) {
    const error = edit?.refused.get(rowKey(objectRow(table?.view.entry ?? "")));
    refusal =
      error === undefined ? m.workshop_bin_material_edit_refused_label() : errorSummary(error);
  }

  const toDefault =
    element !== null && row.declared !== null && removeEntry !== null
      ? () =>
          run(() => {
            hold();
            return removeEntry(element);
          })
      : null;

  return {
    state: {
      changed,
      revert: changed ? () => run(revert) : null,
      revertLabel: baseline === undefined ? "" : revertLabel(baseline, current, nameField),
      toDefault,
      refusal,
      pulse,
    },
    scoped,
  };
}
