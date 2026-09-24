import {
  ArrowCounterClockwiseIcon,
  DotsThreeVerticalIcon,
  EraserIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, use } from "react";

import { type DataTableColumn, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { fieldsOf, TextCell } from "../../classes/components/ClassCells";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import { useRowEdits } from "../hooks/useRowEdits";
import { RowStateContext, TableContext } from "../state/declaredTable";
import type { DeclaredRow } from "../utils/declaredRows";

export const NAME_WIDTH = "flex w-56 shrink-0 items-center gap-1";
const ACTIONS_WIDTH = "flex w-14 shrink-0 items-center justify-end gap-0.5";
const ROW_CLASS =
  "group/row relative flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft";

/** A column heading, as wide as the cells under it. */
export function Heading({ className, children }: { className: string; children: ReactNode }) {
  return <span className={twMerge(className, "select-none")}>{children}</span>;
}

/** The key a row's frame is kept under, which a declared row holds while its entry comes and goes. */
export function frameKey<D>(row: DeclaredRow<D>): string {
  return row.declared === null ? row.key : `declared:${row.name}`;
}

/**
 * One row of a declared table, marking what its edits did: a bar while the row differs from
 * its state before the session edited it, a pulse when an edit lands, a ring when one is
 * refused.
 */
export function DeclaredRowFrame<D>({
  row,
  children,
}: {
  row: DeclaredRow<D>;
  children: ReactNode;
}) {
  const { state, scoped, pulse } = useRowEdits(row);
  const element = row.element;

  return (
    <RowStateContext value={state}>
      <LeafEditContext value={scoped}>
        {/* DS-VEIL, DS-RADIUS */}
        <div
          data-ui="DeclaredRowFrame"
          data-row-key={element === null ? undefined : rowKey(element)}
          className={twMerge(ROW_CLASS, state.refusal !== null && "ring-1 ring-danger/50")}
        >
          {/* DS-SETTING-GUTTER */}
          {state.changed && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0.5 left-0 w-0.5 rounded-full bg-accent-500/50"
            />
          )}
          {pulse > 0 && (
            <span
              key={pulse}
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-fade-out rounded-sm bg-accent-500/15"
            />
          )}
          {children}
        </div>
      </LeafEditContext>
    </RowStateContext>
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
    <span className={twMerge(NAME_WIDTH, changed && "text-accent-300")}>
      {nameRow === undefined && <span className="truncate select-text">{row.name}</span>}
      {nameRow !== undefined && <TextCell row={nameRow} className="min-w-0" />}
      {stray && <RowMark text={m.workshop_bin_material_undeclared_label()} />}
      {warning !== undefined && <RowMark text={warning} />}
    </span>
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
  if (state === null) return <span className={ACTIONS_WIDTH} />;

  const { revert, revertLabel, toDefault, refusal } = state;

  return (
    <span className={ACTIONS_WIDTH}>
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
  );
}

/** The name column, which marks an entry the shader does not declare. */
export function nameColumn<D>(): DataTableColumn<DeclaredRow<D>> {
  return {
    id: "name",
    header: () => <Heading className={NAME_WIDTH}>{m.workshop_bin_material_name_label()}</Heading>,
    cell: ({ row }) => <NameCell row={row.original} />,
  };
}

/** The last column: the row's go-back while it differs, and its other actions. */
export function actionsColumn<D>(): DataTableColumn<DeclaredRow<D>> {
  return {
    id: "actions",
    header: () => <span className={ACTIONS_WIDTH} />,
    cell: () => <RowActions />,
  };
}
