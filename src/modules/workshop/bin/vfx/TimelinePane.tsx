import { ErrorBoundary, Field, TogglePill } from "@/components";
import { m } from "@/i18n";
import { useSetPreviewDisplay, useTimelineHistogram } from "@/stores";

import { useEmitters } from "../emitterChoice";
import { Lanes } from "./Lanes";
import { Notice } from "./Notice";
import { PaneFault } from "./PaneFault";
import { useVfxRun } from "./run";
import { RunTransport } from "./RunTransport";

export interface TimelinePaneProps {
  /** The object's class is one the renderer draws. */
  drawable: boolean;
}

/** The timeline pane: the transport row over one lane per emitter (ADR-0037). */
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
      <TransportRow />
      <Lanes />
    </div>
  );
}

/** The run's controls, "The transport row" in docs/ux/BIN_EDITOR.md, the name filter first. */
function TransportRow() {
  const run = useVfxRun();
  const { filter, setFilter } = useEmitters();
  const histogram = useTimelineHistogram();
  const setDisplay = useSetPreviewDisplay();
  const looping = run.rig.rig.life === "loop";

  return (
    <div className="flex shrink-0 items-center border-b border-surface-700/50 pl-2">
      <Field.Control
        className="h-6 w-40 shrink-0 px-2 font-sans text-meta"
        aria-label={m.workshop_bin_emitter_filter_label()}
        placeholder={m.workshop_bin_emitter_filter_placeholder()}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <RunTransport className="min-w-0 flex-1 justify-end" scrub={false}>
        <TogglePill
          size="xs"
          label={m.workshop_bin_preview_loop_label()}
          active={looping}
          onClick={() =>
            run.setRig({
              preset: run.rig.preset,
              rig: { ...run.rig.rig, life: looping ? "once" : "loop" },
            })
          }
        />
        <TogglePill
          size="xs"
          label={m.workshop_bin_timeline_histogram_label()}
          active={histogram}
          onClick={() => setDisplay({ timelineHistogram: !histogram })}
        />
      </RunTransport>
    </div>
  );
}
