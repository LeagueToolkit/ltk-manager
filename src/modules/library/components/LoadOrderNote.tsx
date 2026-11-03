import { Button } from "@/components";
import { m } from "@/i18n";
import { useArrangeLibrary } from "@/modules/library/api";

import { useLibrarySort } from "../state";

/**
 * The line under the sort pills that says a sort changes the view alone, with the two
 * ways to make it the load order. Draws nothing while the library is in its load order.
 */
export function LoadOrderNote() {
  const sort = useLibrarySort();
  const { arrange, keep, canKeep, isPending } = useArrangeLibrary();

  if (sort.field === "priority") return null;

  return (
    <div
      data-ui="LoadOrderNote"
      className="mt-2 flex items-center justify-between gap-3 rounded-md bg-surface-950/40 py-1.5 pr-1.5 pl-2.5 text-xs text-surface-400"
    >
      <span>{m.library_load_order_note_description()}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={arrange} loading={isPending}>
          {m.library_load_order_arrange_action()}
        </Button>
        {canKeep && (
          <Button variant="ghost" size="xs" onClick={keep} disabled={isPending}>
            {m.library_load_order_keep_action()}
          </Button>
        )}
      </div>
    </div>
  );
}
