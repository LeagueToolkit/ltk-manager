import type { ReactNode } from "react";

import { Separator } from "@/components";

import { ChancePin } from "../../../curves/components/ChancePin";
import { useRunClock, useVfxRun } from "../state/run";
import { Playhead, Transport } from "./Transport";

export interface RunTransportProps {
  /** `mini` is play, the scrub and the time alone, "The timeline" in docs/ux/BIN_EDITOR.md. */
  variant?: "full" | "mini";
  /** The row carries a scrub, which a host drawing a ruler of its own leaves out. */
  scrub?: boolean;
  /** What the host carries at the row's right end, before the chance pin. */
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
  const { playing, speed, looping, setPlaying, setSpeed, setLooping, step, restart } = useVfxRun();

  return (
    <Transport
      variant={variant}
      className={className}
      playing={playing}
      speed={speed}
      looping={looping}
      onPlayingChange={setPlaying}
      onSpeedChange={setSpeed}
      onLoopingChange={setLooping}
      onStep={step}
      onRestart={() => {
        restart();
        setPlaying(true);
      }}
      playhead={<RunPlayhead scrub={scrub} />}
    >
      <span className="ml-auto flex min-w-0 shrink items-center gap-2">
        {children}
        <Separator orientation="vertical" className="mx-0 h-4" />
        <ChancePin className="shrink" />
      </span>
    </Transport>
  );
}

/** The run's playhead, which is what hears the clock. A drag on the scrub pauses the clock. */
function RunPlayhead({ scrub }: { scrub: boolean }) {
  const { span, seek, beginScrub, endScrub } = useVfxRun();
  const time = useRunClock();

  return (
    <Playhead
      time={time}
      span={span}
      scrub={scrub}
      onSeek={(to) => {
        beginScrub();
        seek(to);
      }}
      onSeekCommit={(to) => {
        seek(to);
        endScrub();
      }}
    />
  );
}
