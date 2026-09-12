import {
  ArrowCounterClockwiseIcon,
  CaretLineLeftIcon,
  CaretLineRightIcon,
  GaugeIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Slider, Tooltip } from "@/components";
import { m } from "@/i18n";

/** How finely the scrub divides the window it spans, in seconds. */
const SCRUB_STEP = 1 / 60;

/** The rates the speed spans, slow enough to read one frame and never backwards. */
const SLOWEST = 0.05;
const FASTEST = 2;

/** The slider's own step, finer than the snap so a detent has room to pull from. */
const SPEED_STEP = 0.01;

/** The rates the speed slider stops at on the way past them, and the keys walk. */
export const SPEED_DETENTS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2];

/** How near a detent the handle snaps to it, in the slider's own units. */
const SNAP = 0.04;

/** The detent below or above `speed`, by `direction`, and the end of the row past it. */
export function speedDetent(speed: number, direction: -1 | 1): number {
  const last = SPEED_DETENTS.length - 1;
  if (direction > 0) {
    return SPEED_DETENTS.find((detent) => detent > speed + 1e-6) ?? SPEED_DETENTS[last];
  }
  return [...SPEED_DETENTS].reverse().find((detent) => detent < speed - 1e-6) ?? SPEED_DETENTS[0];
}

export interface TransportProps {
  playing: boolean;
  /** What the frame's own seconds are multiplied by before the scene takes them. */
  speed: number;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: number) => void;
  /** Drawn as a button when given. */
  onRestart?: () => void;
  /** Drawn as a step back and a step forward around play when given, in whole frames. */
  onStep?: (frames: number) => void;
  /** `mini` is play, the scrub and the time alone, "The timeline" in docs/ux/BIN_EDITOR.md. */
  variant?: "full" | "mini";
  /**
   * The scrub and the time, which follow the host's clock.
   *
   * A [`Playhead`] the host renders off its own readout, so a tick of the clock re-renders
   * it alone and never the row around it.
   */
  playhead: ReactNode;
  /** What a host carries after the transport's own controls. */
  children?: ReactNode;
  /** The host's edge, since the row sits under a viewport in one and over the lanes in another. */
  className?: string;
}

/** The transport of a run: play, the steps, the playhead the host draws, and the speed. */
export function Transport({
  playing,
  speed,
  onPlayingChange,
  onSpeedChange,
  onRestart,
  onStep,
  variant = "full",
  playhead,
  children,
  className,
}: TransportProps) {
  const transport = playing
    ? m.workshop_bin_preview_pause_action()
    : m.workshop_bin_preview_play_action();
  const mini = variant === "mini";

  return (
    <div
      data-ui="Transport"
      className={twMerge("flex shrink-0 items-center gap-2 px-2 py-1.5 select-none", className)}
    >
      {!mini && onStep && (
        <StepButton label={m.workshop_bin_preview_step_back_action()} onClick={() => onStep(-1)}>
          <CaretLineLeftIcon weight="bold" className="h-4 w-4" />
        </StepButton>
      )}

      <Button
        variant="ghost"
        size="xs"
        compact
        aria-label={transport}
        onClick={() => onPlayingChange(!playing)}
      >
        {playing && <PauseIcon weight="bold" className="h-4 w-4" />}
        {!playing && <PlayIcon weight="bold" className="h-4 w-4" />}
      </Button>

      {!mini && onStep && (
        <StepButton label={m.workshop_bin_preview_step_forward_action()} onClick={() => onStep(1)}>
          <CaretLineRightIcon weight="bold" className="h-4 w-4" />
        </StepButton>
      )}

      {!mini && onRestart && (
        <StepButton label={m.workshop_bin_preview_restart_action()} onClick={onRestart}>
          <ArrowCounterClockwiseIcon weight="bold" className="h-4 w-4" />
        </StepButton>
      )}

      {playhead}

      {!mini && (
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          <GaugeIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-surface-400" />
          <Slider
            className="w-20"
            aria-label={m.workshop_bin_preview_speed_label()}
            value={speed}
            min={SLOWEST}
            max={FASTEST}
            step={SPEED_STEP}
            onValueChange={(next) => onSpeedChange(snapped(next))}
          />
          <Tooltip content={m.workshop_bin_preview_speed_label()}>
            <span className="w-10 shrink-0 text-right font-mono text-meta text-code whitespace-nowrap text-surface-400 tabular-nums">
              {m.workshop_bin_preview_speed_value({ value: speed.toFixed(2) })}
            </span>
          </Tooltip>
        </div>
      )}

      {children}
    </div>
  );
}

export interface PlayheadProps {
  /** Where the run stands, in seconds. */
  time: number;
  /** The window the scrub spans, and none to hold the scrub still. */
  span: number;
  /** The row carries a scrub, which a host drawing a ruler of its own leaves out. */
  scrub?: boolean;
  /** Stand the run at `time`, live under a drag. */
  onSeek: (time: number) => void;
}

/**
 * The scrub and the time readout, which are the transport's two readers of the clock.
 *
 * A drag seeks on every pointer move, which the checkpoints of decision 2.46 in
 * docs/plans/vfx-particle-renderer.md make cheap.
 */
export function Playhead({ time, span, scrub = true, onSeek }: PlayheadProps) {
  const shown = Math.min(time, span);

  return (
    <>
      {scrub && (
        <Slider
          className="mx-2 min-w-0 flex-1"
          aria-label={m.workshop_bin_preview_scrub_label()}
          value={shown}
          min={0}
          max={Math.max(span, SCRUB_STEP)}
          step={SCRUB_STEP}
          disabled={span <= 0}
          onValueChange={onSeek}
        />
      )}
      <span className="shrink-0 font-mono text-meta text-code whitespace-nowrap text-surface-400 tabular-nums">
        {m.workshop_bin_preview_playhead_label({
          time: shown.toFixed(2),
          span: span.toFixed(2),
        })}
      </span>
    </>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="xs" compact aria-label={label} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

/** `speed` pulled onto the detent it is within `SNAP` of, else itself. */
function snapped(speed: number): number {
  return SPEED_DETENTS.find((detent) => Math.abs(detent - speed) <= SNAP) ?? speed;
}
