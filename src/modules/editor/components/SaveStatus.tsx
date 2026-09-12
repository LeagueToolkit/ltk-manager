import { Button, Spinner } from "@/components";
import { m } from "@/i18n";

import type { TextSaveState } from "../useTextDocumentEditor";

export interface SaveStatusProps {
  state: TextSaveState;
  /** What a buffer the file turned down needs, in a few words. */
  blockedHint: string;
  onRetry: () => void;
}

/**
 * What a self-saving document says about its buffer.
 *
 * Quiet when clean: saving is the document's job rather than an event, and
 * only an edit that is being held back is worth a word.
 */
export function SaveStatus({ state, blockedHint, onRetry }: SaveStatusProps) {
  if (state === "pending" || state === "saving") {
    return <Spinner size="sm" className="h-3 w-3 shrink-0" />;
  }

  if (state === "blocked") {
    /* DS-TEXT */
    return (
      <span className="shrink-0 text-[0.6875rem] text-warning-text select-none">{blockedHint}</span>
    );
  }

  if (state === "failed") {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {/* DS-TEXT */}
        <span className="text-[0.6875rem] text-danger-text select-none">
          {m.editor_save_failed_hint()}
        </span>
        <Button variant="ghost" size="xs" compact onClick={onRetry}>
          {m.editor_save_retry_action()}
        </Button>
      </span>
    );
  }

  return null;
}
