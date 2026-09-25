import {
  ArrowCounterClockwiseIcon,
  DotsThreeVerticalIcon,
  EraserIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, use } from "react";

import { type DataTableColumn, IconButton, Menu, Table, Tooltip } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { fieldsOf, TextCell } from "../../classes/components/ClassCells";
import { nameColumn as fittedColumn } from "../../shared/utils/textCut";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import { useRowEdits } from "../hooks/useRowEdits";
import { RowStateContext, TableContext } from "../state/declaredTable";
import type { DeclaredRow } from "../utils/declaredRows";

/** What the name column holds beside a name, in pixels: a row's mark and the gap before it. */
const NAME_EXTRA = 18;

/** The share of the table past which the name column cuts its names. */
const NAME_CAP = "33cqw";

/** The table a material's list draws as, its type at the row's own tier. */
export const TABLE_CLASS = "w-full text-left text-mono-row";

/* DS-VEIL, DS-RADIUS. The hover fills the row's cells, which round at its two ends. */
export const ROW_CLASS =
  "[&:hover>td]:bg-surface-veil-soft [&>td:first-child]:rounded-l-sm [&>td:first-child]:pl-1.5 [&>td:last-child]:rounded-r-sm [&>td:last-child]:pr-1.5";

const CELL = "relative border-b-0 px-1 py-0.5 align-middle";
const HEAD = "border-b-0 bg-transparent px-1 pt-0 pb-0.5 text-meta font-normal whitespace-nowrap";
const NAME = "flex w-(--name-width) min-w-0 items-center gap-1";
const ACTIONS = "flex w-12 items-center justify-end gap-0.5";

/** The name column the material's tables share, as wide as the longest of `names`. */
export function nameWidth(names: readonly string[]): string {
  return fittedColumn(names, NAME_EXTRA, NAME_CAP);
}

/** The key a row's frame is kept under, which a declared row holds while its entry comes and goes. */
export function frameKey<D>(row: DeclaredRow<D>): string {
  return row.declared === null ? row.key : `declared:${row.name}`;
}

/**
 * One row of a declared table, handing its cells what its edits did: a bar while the row
 * differs from its state before the session edited it, a pulse when an edit lands, a tint
 * when one is refused.
 */
export function DeclaredRowFrame<D>({
  row,
  children,
}: {
  row: DeclaredRow<D>;
  children: ReactNode;
}) {
  const { state, scoped } = useRowEdits(row);
  const element = row.element;

  return (
    <RowStateContext value={state}>
      <LeafEditContext value={scoped}>
        <Table.Row
          data-ui="DeclaredRowFrame"
          data-row-key={element === null ? undefined : rowKey(element)}
          className={twMerge("group/row", ROW_CLASS)}
        >
          {children}
        </Table.Row>
      </LeafEditContext>
    </RowStateContext>
  );
}

/**
 * One cell of a declared row. The row's pulse and refusal are drawn in every cell, which
 * tile into one band across the row.
 */
export function DeclaredCell({
  className,
  colSpan,
  children,
}: {
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  const state = use(RowStateContext);
  const pulse = state?.pulse ?? 0;

  return (
    <Table.Cell
      colSpan={colSpan}
      className={twMerge(CELL, state?.refusal != null && "bg-danger/10", className)}
    >
      {pulse > 0 && (
        <span
          key={pulse}
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-fade-out bg-accent-500/15"
        />
      )}
      {children}
    </Table.Cell>
  );
}

/** A column's heading cell. */
export function Heading({
  className,
  colSpan,
  children,
}: {
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <Table.Head colSpan={colSpan} className={twMerge(HEAD, className)}>
      {children}
    </Table.Head>
  );
}

function NameCell<D>({ row }: { row: DeclaredRow<D> }) {
  const table = use(TableContext);
  const changed = use(RowStateContext)?.changed === true;
  const nameRow =
    row.element === null
      ? undefined
      : fieldsOf(table?.pages.get(rowKey(row.element)))(table?.kind.nameField ?? "");
  const stray = table?.known === true && row.declared === null;
  const warning = table?.warnings.get(row.name);

  return (
    <DeclaredCell>
      {/* DS-SETTING-GUTTER */}
      {changed && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 w-0.5 rounded-full bg-accent-500/50"
        />
      )}
      <span className={twMerge(NAME, changed && "text-accent-300")} title={row.name}>
        {nameRow === undefined && <span className="truncate select-text">{row.name}</span>}
        {nameRow !== undefined && <TextCell row={nameRow} className="min-w-0" />}
        {stray && <RowMark text={m.workshop_bin_material_undeclared_label()} />}
        {warning !== undefined && <RowMark text={warning} />}
      </span>
    </DeclaredCell>
  );
}

/* DS-TEXT */
function RowMark({ text, tone = "warning" }: { text: string; tone?: "warning" | "danger" }) {
  return (
    <WarningCircleIcon
      aria-label={text}
      className={twMerge(
        "h-3.5 w-3.5 shrink-0",
        tone === "warning" ? "text-warning-text" : "text-danger-text",
      )}
    >
      <title>{text}</title>
    </WarningCircleIcon>
  );
}

/** The row's trailing seat: its refusal, its go-back, and a kebab of both actions. */
function RowActions() {
  const state = use(RowStateContext);
  if (state === null) return <DeclaredCell className="pl-0" />;

  const { revert, revertLabel, toDefault, refusal } = state;

  return (
    <DeclaredCell className="pl-0">
      <span className={ACTIONS}>
        {refusal !== null && <RowMark text={refusal} tone="danger" />}
        {revert !== null && (
          <Tooltip content={revertLabel}>
            <IconButton
              variant="ghost"
              size="xs"
              compact
              aria-label={revertLabel}
              icon={<ArrowCounterClockwiseIcon weight="bold" className="h-3 w-3" />}
              onClick={revert}
            />
          </Tooltip>
        )}
        {(revert !== null || toDefault !== null) && (
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton
                  variant="ghost"
                  size="xs"
                  compact
                  aria-label={m.workshop_bin_material_row_actions_label()}
                  className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                  icon={<DotsThreeVerticalIcon weight="bold" className="h-3 w-3" />}
                />
              }
            />
            <Menu.Portal>
              <Menu.Positioner align="end">
                <Menu.Popup>
                  {revert !== null && (
                    <Menu.Item
                      icon={<ArrowCounterClockwiseIcon className="h-4 w-4" />}
                      onClick={revert}
                    >
                      {revertLabel}
                    </Menu.Item>
                  )}
                  {toDefault !== null && (
                    <Menu.Item icon={<EraserIcon className="h-4 w-4" />} onClick={toDefault}>
                      {m.workshop_bin_material_reset_action()}
                    </Menu.Item>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </span>
    </DeclaredCell>
  );
}

/** The name column, which marks an entry the shader does not declare. */
export function nameColumn<D>(): DataTableColumn<DeclaredRow<D>> {
  return {
    id: "name",
    header: () => (
      <Heading>
        <span className={NAME}>{m.workshop_bin_material_name_label()}</span>
      </Heading>
    ),
    cell: ({ row }) => <NameCell row={row.original} />,
  };
}

/** The last column: the row's go-back while it differs, and its other actions. */
export function actionsColumn<D>(): DataTableColumn<DeclaredRow<D>> {
  return {
    id: "actions",
    header: () => (
      <Heading className="pl-0">
        <span className={ACTIONS} />
      </Heading>
    ),
    cell: () => <RowActions />,
  };
}
