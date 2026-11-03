import { ChartBarIcon, FlagIcon, MagnetIcon } from "@phosphor-icons/react";

import { ErrorBoundary, IconButton, Separator } from "@/components";
import { m } from "@/i18n";
import { shortcutOf } from "@/modules/keys";
import { useSetPreviewDisplay, useTimelineHistogram, useTimelineSnap } from "@/stores";

import { Notice } from "../../../shared/preview/Notice";
import { RunTransport } from "../../playback/components/RunTransport";
import { useVfxRun } from "../../playback/state/run";
import { PaneFault } from "../../preview/components/PaneFault";
import { useTimelineMarkers } from "../hooks/useTimelineMarkers";
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
  const snap = useTimelineSnap();
  const setDisplay = useSetPreviewDisplay();
  const markers = useTimelineMarkers();
  const { driver } = useVfxRun();

  return (
    <>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <RunTransport className="min-w-0 flex-1 py-0 pl-0" scrub={false}>
        {markers !== null && (
          <IconButton
            aria-label={m.workshop_bin_timeline_marker_add_action()}
            muted
            icon={<FlagIcon />}
            onClick={() => markers.add(driver.phase)}
            tooltip={m.workshop_bin_timeline_marker_add_hint({ key: shortcutOf("vfx.markerAdd") })}
          />
        )}
        <IconButton
          pressed={snap}
          muted
          icon={<MagnetIcon />}
          onClick={() => setDisplay({ timelineSnap: !snap })}
          label={m.workshop_bin_timeline_snap_label()}
        />
        <IconButton
          pressed={histogram}
          muted
          icon={<ChartBarIcon />}
          onClick={() => setDisplay({ timelineHistogram: !histogram })}
          label={m.workshop_bin_timeline_histogram_label()}
        />
      </RunTransport>
    </>
  );
}
