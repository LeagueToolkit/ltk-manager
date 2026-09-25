import {
  ArrowCounterClockwiseIcon,
  CaretLineLeftIcon,
  CaretLineRightIcon,
  GaugeIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button, IconButton, Separator, Slider, StepperField, Tooltip } from "@/components";
import { m, Marked } from "@/i18n";
import { twMerge } from "@/utils";

/** How finely the scrub divides the window it spans, in seconds. */
const SCRUB_STEP = 1 / 60;

/** The rates the speed spans, slow enough to read one frame and never backwards. */
const SLOWEST = 0.05;
const FASTEST = 2;

/** What the speed field's arrows move the rate by: plain, under Alt, and under Shift. */
const SPEED_NUDGE = { step: 0.1, small: 0.01, large: 0.5 } as const;

/** The digits the speed is drawn to. */
const SPEED_DECIMALS = 3;

/** The speed reads with a point, as the `toFixed` readouts beside it do. */
const SPEED_LOCALE = "en-US";

/** The rates the bracket keys walk. */
export const SPEED_DETENTS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2];

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
  /** Whether the run starts over at its end, drawn as a toggle when `onLoopingChange` is given. */
  looping?: boolean;
  onLoopingChange?: (looping: boolean) => void;
  /** `mini` is play, the scrub and the time alone, "The timeline" in docs/ux/BIN_EDITOR.md. */
  variant?: "full" | "mini";
  /**
   * The scrub and the time, which follow the host's clock.
   *
   * A [`Playhead`] the host renders off its own readout, so a tick of the clock re-renders
   * it alone and never the row around it.
   */
  playhead: ReactNode;
  /** What a host carries after the transport's controls, placed by the host. */
  children?: ReactNode;
  /** The host's edge, since the row sits under a viewport in one and over the lanes in another. */
  className?: string;
}

/**
 * The transport of a run, in two groups a hairline divides.
 *
 * The first moves the playhead: the steps, play and restart around the time. The second is
 * how the run plays: the loop and the speed. Play is the one filled control, so the row
 * reads from it outward.
 */
export function Transport({
  playing,
  speed,
  onPlayingChange,
  onSpeedChange,
  onRestart,
  onStep,
  looping = false,
  onLoopingChange,
  variant = "full",
  playhead,
  children,
  className,
}: TransportProps) {
  const mini = variant === "mini";
  const steps = !mini && onStep !== undefined;
  const loops = onLoopingChange !== undefined;

  return (
    <div
      data-ui="Transport"
      className={twMerge("flex shrink-0 items-center gap-1.5 px-2 py-1 select-none", className)}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        {steps && (
          <StepButton label={m.workshop_bin_preview_step_back_action()} onClick={() => onStep(-1)}>
            <CaretLineLeftIcon weight="bold" className="h-4 w-4" />
          </StepButton>
        )}
        <PlayButton playing={playing} onPlayingChange={onPlayingChange} />
        {steps && (
          <StepButton
            label={m.workshop_bin_preview_step_forward_action()}
            onClick={() => onStep(1)}
          >
            <CaretLineRightIcon weight="bold" className="h-4 w-4" />
          </StepButton>
        )}
        {!mini && onRestart && (
          <StepButton label={m.workshop_bin_preview_restart_action()} onClick={onRestart}>
            <ArrowCounterClockwiseIcon weight="bold" className="h-4 w-4" />
          </StepButton>
        )}
      </div>

      {playhead}

      {(loops || !mini) && <Separator orientation="vertical" className="mx-1 h-4" />}

      <div className="flex shrink-0 items-center gap-1.5">
        {loops && <LoopToggle looping={looping} onLoopingChange={onLoopingChange} />}
        {!mini && <SpeedField speed={speed} onSpeedChange={onSpeedChange} />}
      </div>

      {children}
    </div>
  );
}

/** Play or pause, the transport's one filled control. */
function PlayButton({
  playing,
  onPlayingChange,
}: Pick<TransportProps, "playing" | "onPlayingChange">) {
  const label = playing
    ? m.workshop_bin_preview_pause_action()
    : m.workshop_bin_preview_play_action();
  const hint = playing ? m.workshop_bin_preview_pause_hint() : m.workshop_bin_preview_play_hint();
  const Glyph = playing ? PauseIcon : PlayIcon;

  return (
    <Tooltip content={hint}>
      <IconButton
        variant="filled"
        size="xs"
        compact
        aria-label={label}
        icon={<Glyph weight="fill" className="h-4 w-4" />}
        onClick={() => onPlayingChange(!playing)}
      />
    </Tooltip>
  );
}

/** The loop switch, lit while the run starts over at its end. */
function LoopToggle({
  looping,
  onLoopingChange,
}: {
  looping: boolean;
  onLoopingChange: (looping: boolean) => void;
}) {
  return (
    <Tooltip content={m.workshop_bin_preview_loop_hint()}>
      <IconButton
        variant="ghost"
        size="xs"
        compact
        aria-label={m.workshop_bin_preview_loop_label()}
        aria-pressed={looping}
        className="text-surface-400 aria-pressed:bg-accent-500/15 aria-pressed:text-accent-300"
        icon={<RepeatIcon weight="bold" className="h-4 w-4" />}
        onClick={() => onLoopingChange(!looping)}
      />
    </Tooltip>
  );
}

/** The rate typed to three places, under the gauge that names it. */
function SpeedField({ speed, onSpeedChange }: Pick<TransportProps, "speed" | "onSpeedChange">) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Tooltip content={m.workshop_bin_preview_speed_label()}>
        <span className="flex shrink-0">
          <GaugeIcon aria-hidden className="h-3.5 w-3.5 text-surface-400" />
        </span>
      </Tooltip>
      <StepperField
        className="w-20 text-meta"
        aria-label={m.workshop_bin_preview_speed_label()}
        increaseLabel={m.workshop_bin_preview_speed_up_action()}
        decreaseLabel={m.workshop_bin_preview_speed_down_action()}
        value={speed}
        min={SLOWEST}
        max={FASTEST}
        step={SPEED_NUDGE.step}
        smallStep={SPEED_NUDGE.small}
        largeStep={SPEED_NUDGE.large}
        decimals={SPEED_DECIMALS}
        locale={SPEED_LOCALE}
        onValueChange={onSpeedChange}
      />
    </span>
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
  /** Commit `time` once a drag is released or a key has moved the scrub. */
  onSeekCommit?: (time: number) => void;
}

/**
 * The scrub and the time readout, which are the transport's two readers of the clock.
 *
 * A drag seeks on every pointer move, which the checkpoints of decision 2.46 in
 * docs/plans/vfx-particle-renderer.md make cheap.
 */
export function Playhead({ time, span, scrub = true, onSeek, onSeekCommit }: PlayheadProps) {
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
          onValueCommitted={onSeekCommit}
        />
      )}
      <span
        role="timer"
        aria-label={m.workshop_bin_preview_readout_label()}
        className="shrink-0 px-1 font-mono text-row text-code whitespace-nowrap text-surface-400 tabular-nums"
      >
        <Marked
          text={m.workshop_bin_preview_playhead_label({
            time: shown.toFixed(2),
            span: span.toFixed(2),
          })}
        >
          {(now) => <span className="font-medium text-surface-100">{now}</span>}
        </Marked>
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
