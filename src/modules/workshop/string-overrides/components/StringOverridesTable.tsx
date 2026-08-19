import { type CellContext, createColumnHelper, type FilterFn } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  Button,
  DataTable,
  DataTableColumnHeader,
  EmptyState,
  Field,
  IconButton,
  Tooltip,
} from "@/components";
import type { StringKeySuggestion } from "@/lib/tauri";

import type { OverrideEntry, OverrideEntryField } from "../types";
import { StringKeyField } from "./StringKeyField";

const KEY_HINT =
  "The key identifying the string to override. Field names are usually found in the game's .bin files, in locations that vary by context (e.g. champion, item, or UI data).";
const VALUE_HINT =
  "The replacement text for this field. The original value can be looked up in the game's stringtable.";

/** Handlers and per-row state threaded to cells via the table's `meta`. */
interface StringOverridesTableMeta {
  errors: Record<string, string>;
  pendingFocusId: string | null;
  onUpdate: (id: string, field: OverrideEntryField, value: string) => void;
  onPick: (id: string, suggestion: StringKeySuggestion) => void;
  onRemove: (id: string) => void;
  onFocusHandled: () => void;
}

function getMeta(ctx: CellContext<OverrideEntry, unknown>): StringOverridesTableMeta {
  return ctx.table.options.meta as StringOverridesTableMeta;
}

function KeyCell({ ctx }: { ctx: CellContext<OverrideEntry, unknown> }) {
  const entry = ctx.row.original;
  const meta = getMeta(ctx);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoFocus = meta.pendingFocusId === entry.id;

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;

    el.focus();
    el.scrollIntoView({ block: "nearest" });
    meta.onFocusHandled();
  }, [autoFocus, meta]);

  return (
    <StringKeyField
      value={entry.key}
      error={meta.errors[entry.id]}
      inputRef={inputRef}
      onChange={(key) => meta.onUpdate(entry.id, "key", key)}
      onPick={(suggestion) => meta.onPick(entry.id, suggestion)}
    />
  );
}

function ValueCell({ ctx }: { ctx: CellContext<OverrideEntry, unknown> }) {
  const entry = ctx.row.original;
  const meta = getMeta(ctx);

  return (
    <Field.Root>
      <Field.Control
        type="text"
        value={entry.value}
        onChange={(e) => meta.onUpdate(entry.id, "value", e.target.value)}
        placeholder="Fox Spirit"
      />
    </Field.Root>
  );
}

function ActionsCell({ ctx }: { ctx: CellContext<OverrideEntry, unknown> }) {
  const entry = ctx.row.original;
  const meta = getMeta(ctx);

  return (
    <Tooltip content="Delete entry">
      <IconButton
        icon={<Trash2 className="h-4 w-4" />}
        variant="ghost"
        size="sm"
        onClick={() => meta.onRemove(entry.id)}
      />
    </Tooltip>
  );
}

const columnHelper = createColumnHelper<OverrideEntry>();

const columns = [
  columnHelper.accessor("key", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} hint={KEY_HINT}>
        Key
      </DataTableColumnHeader>
    ),
    cell: (ctx) => <KeyCell ctx={ctx} />,
    sortingFn: "text",
  }),
  columnHelper.accessor("value", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} hint={VALUE_HINT}>
        Value
      </DataTableColumnHeader>
    ),
    cell: (ctx) => <ValueCell ctx={ctx} />,
    sortingFn: "text",
  }),
  columnHelper.display({
    id: "actions",
    cell: (ctx) => <ActionsCell ctx={ctx} />,
    meta: { headerClassName: "w-9", cellClassName: "w-9" },
  }),
];

// Keep freshly-added rows (blank key) visible even while a filter is active, so
// the author can fill them in without the row disappearing.
const globalFilterFn: FilterFn<OverrideEntry> = (row, _columnId, filterValue) => {
  const entry = row.original;
  if (!entry.key.trim()) return true;

  const query = String(filterValue).trim().toLowerCase();
  if (!query) return true;

  return entry.key.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query);
};

interface StringOverridesTableProps {
  entries: OverrideEntry[];
  errors: Record<string, string>;
  filter: string;
  pendingFocusId: string | null;
  onClearFilter: () => void;
  onFocusHandled: () => void;
  onUpdateEntry: (id: string, field: OverrideEntryField, value: string) => void;
  onPickSuggestion: (id: string, suggestion: StringKeySuggestion) => void;
  onRemoveEntry: (id: string) => void;
  className?: string;
  scrollClassName?: string;
}

export function StringOverridesTable({
  entries,
  errors,
  filter,
  pendingFocusId,
  onClearFilter,
  onFocusHandled,
  onUpdateEntry,
  onPickSuggestion,
  onRemoveEntry,
  className,
  scrollClassName,
}: StringOverridesTableProps) {
  const meta = useMemo<StringOverridesTableMeta>(
    () => ({
      errors,
      pendingFocusId,
      onUpdate: onUpdateEntry,
      onPick: onPickSuggestion,
      onRemove: onRemoveEntry,
      onFocusHandled,
    }),
    [errors, pendingFocusId, onUpdateEntry, onPickSuggestion, onRemoveEntry, onFocusHandled],
  );

  return (
    <DataTable
      columns={columns}
      data={entries}
      getRowId={(row) => row.id}
      meta={meta}
      globalFilter={filter}
      globalFilterFn={globalFilterFn}
      className={className}
      scrollClassName={scrollClassName}
      emptyState={
        <EmptyState
          size="sm"
          title={`No overrides match "${filter.trim()}"`}
          action={
            <Button variant="ghost" size="sm" onClick={onClearFilter}>
              Clear filter
            </Button>
          }
        />
      }
    />
  );
}
