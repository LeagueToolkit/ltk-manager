import type { ReactNode } from "react";

import { ChancePin } from "../ChancePin";
import { useRunClock, useVfxRun } from "./run";
import { Playhead, Transport } from "./Transport";

export interface RunTransportProps {
  /** `mini` is play, the scrub and the time alone, "The timeline" in docs/ux/BIN_EDITOR.md. */
  variant?: "full" | "mini";
  /** The row carries a scrub, which a host drawing a ruler of its own leaves out. */
  scrub?: boolean;
  /** What the host carries after the transport's own controls. */
  children?: ReactNode;
  className?: string;
}

/**
 * The shell's run on a transport, wherever a pane draws one (ADR-0037).
 *
 * The row reads the run's state, and the playhead alone reads its clock, so a tick
 * re-renders the scrub and the readout and nothing beside them.
 */
export function RunTransport({ variant, scrub = true, children, className }: RunTransportProps) {
  const { playing, speed, setPlaying, setSpeed, step } = useVfxRun();

  return (
    <Transport
      variant={variant}
      className={className}
      playing={playing}
      speed={speed}
      onPlayingChange={setPlaying}
      onSpeedChange={setSpeed}
      onStep={step}
      playhead={<RunPlayhead scrub={scrub} />}
    >
      {children}
      <ChancePin className="ml-2 shrink" />
    </Transport>
  );
}

/** The run's own playhead, which is what hears the clock. */
function RunPlayhead({ scrub }: { scrub: boolean }) {
  const { span, seek } = useVfxRun();
  const time = useRunClock();
  return <Playhead time={time} span={span} scrub={scrub} onSeek={seek} />;
}
