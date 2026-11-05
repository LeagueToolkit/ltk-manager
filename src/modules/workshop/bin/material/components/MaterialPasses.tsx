import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo } from "react";

import { Button, Checkbox, IconButton, Menu, Select } from "@/components";
import { m } from "@/i18n";
import type { BinRow, PassProgram } from "@/lib/tauri";

import {
  Cell,
  elementsOf,
  fieldsOf,
  None,
  type WidgetProps,
} from "../../classes/components/ClassCells";
import { useBinRead } from "../../documents/hooks/useBinRead";
import { nameHash } from "../../shared/utils/binHash";
import { childCount, rowKey } from "../../tree/utils/binRows";
import { RowValue } from "../../values/components/RowValue";
import { type PassEdits, usePassEdits } from "../hooks/usePassEdits";
import { useProgram } from "../hooks/useShaderSchema";
import {
  type Blend,
  blendFields,
  blendOf,
  BLENDS,
  type Cull,
  cullFields,
  cullOf,
  DEPTH_WRITE,
  depthWriteFields,
  PASS_FIELD,
} from "../utils/passState";

const PASSES = nameHash("passes");

const BLEND_LABEL: Record<Blend, () => string> = {
  opaque: m.workshop_bin_material_blend_opaque_label,
  alpha: m.workshop_bin_material_blend_alpha_label,
  additive: m.workshop_bin_material_blend_additive_label,
  premultiplied: m.workshop_bin_material_blend_premultiplied_label,
  multiply: m.workshop_bin_material_blend_multiply_label,
};

const CULL_LABEL: Record<Cull, () => string> = {
  back: m.workshop_bin_material_cull_back_label,
  front: m.workshop_bin_material_cull_front_label,
  none: m.workshop_bin_material_cull_none_label,
};

/** The value a blend select holds for factors no pick writes. */
const CUSTOM = "custom";

/* DS-VEIL, DS-RADIUS. The inline select a row's enum takes, as `RowValue` draws one. */
const TRIGGER =
  "h-auto w-auto min-w-0 gap-1 rounded-sm border-surface-veil bg-surface-veil-soft px-1.5 py-0.5 text-meta text-surface-200 disabled:opacity-60";

/**
 * The passes of the technique the material draws with, each a row: its shader, how it blends,
 * which faces it culls and whether it tests and writes depth, with actions that add, copy,
 * reorder and remove passes. The raw fields stay under Techniques.
 *
 * "Passes" in docs/ux/BIN_EDITOR.md. The state each row shows is the program read's, with the
 * class defaults filled in, so a field the pass leaves unwritten reads as the engine reads it.
 */
export function MaterialPasses({ section, pages, view }: WidgetProps) {
  const program = useProgram(view);
  const techniques = elementsOf(section.rows, pages);
  const technique = program?.technique ?? null;
  const techniqueRow = technique === null ? undefined : techniques[technique];
  const passesRow =
    techniqueRow === undefined ? undefined : fieldsOf(pages.get(rowKey(techniqueRow)))(PASSES);
  const passes = useMemo(
    () => (passesRow === undefined ? [] : (pages.get(rowKey(passesRow))?.rows ?? [])),
    [passesRow, pages],
  );
  const fields = useBinRead(
    view.document,
    useMemo(() => passes.map((pass) => ({ key: rowKey(pass), rows: childCount(pass) })), [passes]),
  );
  const edits = usePassEdits(view.entry, technique, techniques.length);

  if (program === null) return <None />;

  return (
    <div className="flex flex-col font-sans" data-ui="MaterialPasses">
      {passes.length === 0 && <None />}
      <ol className="flex flex-col">
        {passes.map((pass, index) => (
          <PassRow
            key={rowKey(pass)}
            index={index}
            count={passes.length}
            shader={fieldsOf(fields.get(rowKey(pass)))(PASS_FIELD.shader)}
            program={program.passes[index] ?? null}
            edits={edits}
          />
        ))}
      </ol>
      {edits !== null && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 self-start"
          left={<PlusIcon weight="bold" className="size-3.5" />}
          onClick={edits.append}
        >
          {m.workshop_bin_material_pass_add_action()}
        </Button>
      )}
    </div>
  );
}

interface PassRowProps {
  index: number;
  count: number;
  /** The pass's `shader` row, undefined until its fields are read or where it links none. */
  shader: BinRow | undefined;
  /** What the program read made of the pass, null while it is unread. */
  program: PassProgram | null;
  edits: PassEdits | null;
}

function PassRow({ index, count, shader, program, edits }: PassRowProps) {
  const state = program?.pass.state ?? null;
  const failed = program?.program.kind === "failed" ? program.program.reason : null;
  const blend = state === null ? null : blendOf(state);
  const disabled = edits === null || state === null;
  const write = (fields: Parameters<PassEdits["setFields"]>[1]) => edits?.setFields(index, fields);

  return (
    /* DS-VEIL, DS-RADIUS. A hairline between passes, the hover over the whole pass. */
    <li
      data-ui="MaterialPasses:pass"
      className="group/reveal flex flex-col gap-1 rounded-sm border-t border-surface-700/40 px-1.5 py-1.5 first:border-t-0 hover:bg-surface-veil-soft"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-12 shrink-0 text-meta text-surface-400 tabular-nums">
          {m.workshop_bin_material_scope_pass_label({ number: index + 1 })}
        </span>
        <span className="flex min-w-0 flex-1 items-center font-mono text-mono-row">
          {shader === undefined ? (
            <span className="text-meta text-surface-500">
              {m.workshop_bin_material_pass_no_shader_label()}
            </span>
          ) : (
            <Cell row={shader} className="flex min-w-0 flex-1 items-center">
              <RowValue row={shader} />
            </Cell>
          )}
        </span>
        {failed !== null && (
          /* DS-TEXT */
          <WarningCircleIcon
            aria-label={m.workshop_bin_material_program_failed_label()}
            className="size-3.5 shrink-0 text-danger-text"
          >
            <title>{`${m.workshop_bin_material_program_failed_label()}: ${failed}`}</title>
          </WarningCircleIcon>
        )}
        {edits !== null && <PassMenu index={index} count={count} edits={edits} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-13.5 text-meta text-surface-400">
        <Labeled label={m.workshop_bin_material_blend_label()}>
          <InlineSelect
            label={m.workshop_bin_material_blend_label()}
            value={blend ?? CUSTOM}
            options={[
              ...Object.keys(BLENDS).map((each) => ({
                value: each,
                label: BLEND_LABEL[each as Blend](),
              })),
              ...(blend === null
                ? [{ value: CUSTOM, label: m.workshop_bin_material_blend_custom_label() }]
                : []),
            ]}
            disabled={disabled}
            onChange={(next) => next !== CUSTOM && write(blendFields(next as Blend))}
          />
        </Labeled>
        <Labeled label={m.workshop_bin_material_cull_label()}>
          <InlineSelect
            label={m.workshop_bin_material_cull_label()}
            value={state === null ? "back" : cullOf(state)}
            options={(Object.keys(CULL_LABEL) as Cull[]).map((each) => ({
              value: each,
              label: CULL_LABEL[each](),
            }))}
            disabled={disabled}
            onChange={(next) => write(cullFields(next as Cull))}
          />
        </Labeled>
        <Checkbox
          size="sm"
          label={m.workshop_bin_material_depth_test_label()}
          checked={state?.depthEnable ?? true}
          disabled={disabled}
          onCheckedChange={(on) => write([[PASS_FIELD.depthEnable, { type: "bool", value: on }]])}
        />
        <Checkbox
          size="sm"
          label={m.workshop_bin_material_depth_write_label()}
          checked={state === null || (state.writeMask & DEPTH_WRITE) !== 0}
          disabled={disabled}
          onCheckedChange={(on) => state !== null && write(depthWriteFields(state, on))}
        />
      </div>
    </li>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="select-none">
        {label}
      </span>
      {children}
    </span>
  );
}

function InlineSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const labelOf = (option: string) => options.find((each) => each.value === option)?.label ?? "";

  return (
    <Select.Root
      value={value}
      disabled={disabled}
      onValueChange={(next) => next !== null && next !== value && onChange(next)}
    >
      <Select.Trigger aria-label={label} className={TRIGGER}>
        <Select.Value>{(current: string | null) => labelOf(current ?? value)}</Select.Value>
        <CaretDownIcon weight="bold" className="size-3 shrink-0 text-surface-400" />
      </Select.Trigger>
      <Select.Content>
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value} disabled={option.value === CUSTOM}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/** A pass's actions: reorder, copy and remove. */
function PassMenu({ index, count, edits }: { index: number; count: number; edits: PassEdits }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            aria-label={m.workshop_bin_material_pass_actions_label({ number: index + 1 })}
            size="row"
            reveal
            icon={<DotsThreeVerticalIcon />}
          />
        }
      />
      <Menu.Content align="end">
        <Menu.Item
          icon={<ArrowUpIcon className="size-4" />}
          disabled={index === 0}
          onClick={() => edits.move(index, index - 1)}
        >
          {m.workshop_bin_material_pass_move_up_action()}
        </Menu.Item>
        <Menu.Item
          icon={<ArrowDownIcon className="size-4" />}
          disabled={index === count - 1}
          onClick={() => edits.move(index, index + 1)}
        >
          {m.workshop_bin_material_pass_move_down_action()}
        </Menu.Item>
        <Menu.Item icon={<CopyIcon className="size-4" />} onClick={() => edits.duplicate(index)}>
          {m.workshop_bin_material_pass_duplicate_action()}
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item
          icon={<TrashIcon className="size-4" />}
          variant="danger"
          onClick={() => edits.remove(index)}
        >
          {m.workshop_bin_material_pass_remove_action()}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
