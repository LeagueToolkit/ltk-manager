import { Button } from "@/components";
import { m } from "@/i18n";

/** What a pane says in place of a render that threw, and the way to draw it again. */
export function PaneFault({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-ui="PaneFault"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center select-none"
    >
      <span className="text-meta text-surface-400">{m.workshop_bin_pane_fault_title()}</span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        {m.workshop_bin_pane_fault_retry_action()}
      </Button>
    </div>
  );
}
