import { ChartBarIcon } from "@phosphor-icons/react";

import { ErrorBoundary, IconButton, Separator, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useSetPreviewDisplay, useTimelineHistogram } from "@/stores";

import { RunTransport } from "../../playback/components/RunTransport";
import { useVfxRun } from "../../playback/state/run";
import { Notice } from "../../preview/components/Notice";
import { PaneFault } from "../../preview/components/PaneFault";
import { Lanes } from "./Lanes";

export interface TimelinePaneProps {
  /** The object's class is one the renderer draws. */
  drawable: boolean;
}

/** The timeline pane: one lane per emitter, under the transport its strip carries (ADR-0037). */
export function TimelinePane({ drawable }: TimelinePaneProps) {
  if (!drawable) return <Notice text={m.workshop_bin_preview_pane_empty()} />;
  return (
    <ErrorBoundary fallback={(retry) => <PaneFault onRetry={retry} />}>
      <Timeline />
    </ErrorBoundary>
  );
}

function Timeline() {
  const { system, error, pending } = useVfxRun();

  if (pending) return <Notice text={m.workshop_bin_preview_loading_label()} />;
  if (error !== null) return <Notice text={m.workshop_bin_preview_failed_empty()} />;
  if (system === null || system.emitters.length === 0) {
    return <Notice text={m.workshop_bin_preview_emitters_empty()} />;
  }

  return (
    <div data-ui="TimelinePane" className="flex min-h-0 flex-1 flex-col select-none">
      <Lanes />
    </div>
  );
}

/**
 * The run's controls in the timeline pane's strip, "The transport row" in
 * docs/ux/BIN_EDITOR.md.
 *
 * The strip carries them after the pane tabs, so the lanes keep the row a separate transport
 * row would take. The view switches sit at the far end.
 */
export function TimelineTransport() {
  const histogram = useTimelineHistogram();
  const setDisplay = useSetPreviewDisplay();

  return (
    <>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <RunTransport className="min-w-0 flex-1 py-0 pl-0" scrub={false}>
        <Tooltip content={m.workshop_bin_timeline_histogram_label()}>
          <IconButton
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_timeline_histogram_label()}
            aria-pressed={histogram}
            className="text-surface-400 aria-pressed:bg-accent-500/15 aria-pressed:text-accent-300"
            icon={<ChartBarIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setDisplay({ timelineHistogram: !histogram })}
          />
        </Tooltip>
      </RunTransport>
    </>
  );
}
