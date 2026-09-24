import { type ReactNode, use, useMemo } from "react";

import { InputDefaultContext } from "@/components";
import { m } from "@/i18n";
import type { BinRow, ValueEdit } from "@/lib/tauri";

import { CurveToggle, FieldRow } from "../../../classes/components/ClassCells";
import { useClassSchema } from "../../../classes/hooks/useClassSchema";
import { useCurveChain, useCurveDock } from "../../../curves/state/curveTarget";
import { curveActivationEdits, curveDynamicsClass } from "../../../curves/utils/curveEdits";
import { useBinRead } from "../../../documents/hooks/useBinRead";
import { nameHash } from "../../../shared/utils/binHash";
import { BinEditContext } from "../../../tree/hooks/useBinEdit";
import { LeafEditContext, type LeafEdit } from "../../../tree/hooks/useLeafEdit";
import { RowDocumentContext } from "../../../tree/state/rowFold";
import { rowKey } from "../../../tree/utils/binRows";
import { defaultValue, parseDefault } from "../utils/defaultValue";
import type { DefaultField } from "../utils/emitterGroups";
import { emitterLabel } from "../utils/emitterLabels";

const CONSTANT_NAME = "constantValue";
const CONSTANT_FIELD = nameHash(CONSTANT_NAME);

/**
 * A default or optional emitter value, authored through one property declaration.
 *
 * `within` is an embed of `holder` the file does not hold yet, which the field sits in, and
 * an edit creates it on the way.
 */
export function DefaultProperty({
  field,
  holder,
  width,
  owner,
  authored,
  rail,
  within,
  depth = 0,
}: {
  field: DefaultField;
  holder: BinRow;
  width: string;
  owner: string | null;
  authored?: BinRow;
  rail?: ReactNode;
  within?: DefaultField;
  depth?: number;
}) {
  const edit = use(LeafEditContext);
  const document = use(RowDocumentContext);
  const { aim } = useCurveDock();
  const chain = useCurveChain(field.name);
  const raw = parseDefault(field.defaultValue);
  const optional = field.declared?.kind === "option";
  const present = authored?.value.type === "optional" && authored.value.present;
  const requests = useMemo(
    () =>
      present && authored !== undefined && document !== null
        ? [{ key: rowKey(authored), rows: 1 }]
        : [],
    [present, authored, document],
  );
  const children = useBinRead(document ?? 0, requests);
  const item = authored === undefined ? undefined : children.get(rowKey(authored))?.rows[0];
  const compound = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  const constant = compound && Object.hasOwn(raw, CONSTANT_NAME);
  const { data: schema } = useClassSchema(constant ? (field.classHash ?? null) : null);
  const child = schema?.fields.find((item) => item.hash === CONSTANT_FIELD);
  const declared = constant ? (child?.declared ?? null) : field.declared;
  const shape =
    optional && declared?.value != null
      ? { kind: declared.value, key: null, value: null }
      : declared;
  const value =
    item?.value ??
    defaultValue(shape, constant ? (raw as Record<string, unknown>).constantValue : raw);
  const path = optional ? "[0]" : constant ? CONSTANT_FIELD.slice(2) : "";
  const unavailable = present && item === undefined;
  const insert = optional && authored?.value.type === "optional" && !authored.value.present;
  const segment = within === undefined ? "" : field.hash.slice(2);
  const rowPath = [holder.path, within?.hash.slice(2), field.hash.slice(2)]
    .filter(Boolean)
    .join(".");
  const scoped = useMemo<LeafEdit | null>(() => {
    if (edit?.editProperty === undefined || unavailable || value === null) {
      return null;
    }

    const refused = new Map(edit.refused);
    const error = refused.get(rowKey(holder));
    if (error !== undefined) {
      refused.set(`${holder.entry}:${rowPath}`, error);
    }

    return {
      refused,
      commit: async (_row, typed) => {
        if (!typed.ok) {
          return false;
        }

        const edits: ValueEdit[] = [];
        if (within !== undefined) {
          edits.push({ type: "ensureProperty", path: "", field: field.hash });
        }

        if (constant) {
          edits.push({
            type: "ensureProperty",
            path: segment,
            field: CONSTANT_FIELD,
          });
        }

        if (insert) {
          edits.push({
            type: "insertItem",
            path: segment,
            item: { index: null, key: null, class: null },
          });
        }

        edits.push({ type: "setLeaf", path: under(segment, path), value: typed.leaf });
        return edit.editProperty!(holder, within?.hash ?? field.hash, edits);
      },
    };
  }, [
    edit,
    holder,
    field.hash,
    within,
    segment,
    path,
    rowPath,
    constant,
    insert,
    unavailable,
    value,
  ]);

  const row: BinRow = {
    entry: holder.entry,
    path: rowPath,
    label: [holder.label, within?.name, field.name].filter(Boolean).join("."),
    node: "property",
    name: field.name,
    unnamed: field.name === field.hash,
    kind: shape?.kind ?? null,
    declared:
      authored?.declared ??
      (field.declared === null ? null : { shape: field.declared, mismatch: false }),
    value: value ?? { type: "undrawn" },
  };
  const dynamicsClass = curveDynamicsClass(field.classHash);

  async function activateCurve() {
    if (edit?.editProperty === undefined || dynamicsClass === null || field.classHash == null)
      return;

    const edits = curveActivationEdits(field.classHash, value, "value");
    if (edits === null) return;

    const activated = await edit.editProperty(holder, field.hash, edits);
    if (!activated) return;

    aim({
      row: {
        ...row,
        kind: field.declared?.kind ?? null,
        value: {
          type: "struct",
          classHash: field.classHash,
          class: schema?.name ?? null,
          len: 1,
        },
      },
      chain,
      tab: "graph",
    });
  }

  const implicit = authored === undefined || insert;
  let placeholder: string | undefined;
  if (unavailable) {
    placeholder = m.workshop_bin_inspector_loading_label();
  } else if (value === null && raw === null) {
    placeholder = m.workshop_bin_inspector_default_unset_label();
  } else if (value === null) {
    placeholder =
      raw === undefined
        ? m.workshop_bin_inspector_default_unknown_label()
        : m.workshop_bin_inspector_default_settings_label();
  } else if (value.type === "null" || (value.type === "optional" && !value.present)) {
    placeholder = m.workshop_bin_inspector_default_unset_label();
  }

  const valueSlot =
    placeholder === undefined ? undefined : (
      <span
        className="font-sans text-meta text-surface-400 italic"
        title={field.defaultValue ?? undefined}
      >
        {placeholder}
      </span>
    );

  return (
    <div title={implicit ? m.workshop_bin_force_default_label() : undefined}>
      <InputDefaultContext value={implicit}>
        <RowDocumentContext value={null}>
          <BinEditContext value={null}>
            <LeafEditContext value={scoped}>
              <FieldRow
                row={row}
                label={emitterLabel(field.hash, field.name)}
                tableLayout
                width={width}
                depth={depth}
                owner={owner}
                rail={rail}
                valueSlot={valueSlot}
                valueAction={
                  dynamicsClass === null ||
                  edit?.editProperty === undefined ||
                  within !== undefined ? undefined : (
                    <CurveToggle onConstant={() => {}} onCurve={() => void activateCurve()} />
                  )
                }
              />
            </LeafEditContext>
          </BinEditContext>
        </RowDocumentContext>
      </InputDefaultContext>
    </div>
  );
}

/** `path` under the field `segment` names, as a path relative to the edited property reads. */
function under(segment: string, path: string): string {
  if (segment === "" || path === "") {
    return segment + path;
  }

  return path.startsWith("[") ? `${segment}${path}` : `${segment}.${path}`;
}
