import { ArrowElbowDownRightIcon, CaretRightIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { memo, useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";

import { EmptyTile } from "../ClassCells";
import { CutText } from "../CutText";
import { useEmitters } from "../emitterChoice";
import type { EmitterCardData } from "../emitterTypes";
import { CardSquare } from "../VfxSections";
import { liveCount } from "./histogram";
import { childBars, type ChildLane, type LaneBar, laneBar, type TimeWindow } from "./laneModel";
import { type LaneGestures, SoloToggle, VisibleToggle } from "./laneVisibility";
import type { EmitterModel } from "./model";
import { useVfxRun } from "./run";
import { Track } from "./Track";

/** The room the live count takes at a lane's right edge, in pixels. */
export const COUNT = 40;

/** One row of the lanes: an emitter of the opened system, or a child lane nested under one. */
export type Row =
  | { readonly kind: "emitter"; readonly emitter: EmitterModel; readonly nested: boolean }
  | { readonly kind: "child"; readonly lane: ChildLane; readonly parent: EmitterModel };

interface LaneRowProps {
  row: Row;
  view: TimeWindow;
  width: number;
  /** The head's CSS width, which the ruler's row and the overlays share. */
  head: string;
  gestures: LaneGestures;
  card: EmitterCardData | undefined;
  /** How many children the pass has spawned, which a child lane redraws its bars on. */
  spawned: number;
  expanded: boolean;
  onExpand: (emitter: number) => void;
  onSelect: (row: Row) => void;
  onSeek: (x: number) => void;
}

/**
 * One lane: its head, its bars, and the live count at its edge.
 *
 * Memoised on its props, so the clock redraws the count through the DOM and a row renders
 * on a change of its own alone.
 */
export const LaneRow = memo(function LaneRow({
  row,
  view,
  width,
  head,
  gestures,
  card,
  spawned,
  expanded,
  onExpand,
  onSelect,
  onSeek,
}: LaneRowProps) {
  const run = useVfxRun();
  const { open, child } = useEmitters();
  const emitter = row.kind === "emitter" ? row.emitter : row.lane.emitter;
  const bars = useMemo<readonly LaneBar[]>(() => {
    if (row.kind === "emitter") return [laneBar(row.emitter)];
    const { driver } = run;
    /* The list grows in place, so the count is what says a new bar is owed. */
    const births = driver.births().slice(0, spawned);
    return childBars(births, row.lane, driver.time - driver.phase);
  }, [row, run, spawned]);
  const selected =
    row.kind === "emitter"
      ? child === null && card !== undefined && open?.key === card.key
      : child !== null && child.path === row.lane.path && child.emitter.index === emitter.index;
  const muted = row.kind === "emitter" && run.muted.has(emitter.index);
  const soloed = row.kind === "emitter" && run.soloed.has(emitter.index);
  const dimmed = emitter.disabled || muted || (run.soloed.size > 0 && !soloed);

  return (
    <div
      data-ui="Lanes:lane"
      data-row-key={card?.key}
      className={twMerge(
        "flex h-6 items-center border-b border-surface-700/30 hover:bg-surface-veil-soft",
        selected && "bg-accent-500/10",
      )}
    >
      <div
        className={twMerge(
          "flex h-full shrink-0 items-center gap-1 border-r border-surface-700/50 px-1 font-mono text-code select-none",
          row.kind === "child" && "pl-5",
          dimmed && "opacity-60",
        )}
        style={{ width: head }}
      >
        {row.kind === "emitter" && row.nested && (
          <button
            type="button"
            aria-label={m.workshop_bin_timeline_children_action()}
            aria-expanded={expanded}
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 hover:bg-surface-veil hover:text-surface-200"
            onClick={() => onExpand(emitter.index)}
          >
            <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", expanded && "rotate-90")} />
          </button>
        )}
        {row.kind === "emitter" && !row.nested && <span className="w-4 shrink-0" />}
        {row.kind === "child" && (
          <ArrowElbowDownRightIcon className="h-3 w-3 shrink-0 text-surface-500" />
        )}
        {row.kind === "emitter" && (
          <VisibleToggle lane={emitter.index} hidden={muted} gestures={gestures} />
        )}
        {card !== undefined && <CardSquare card={card} size="row" />}
        {card === undefined && <EmptyTile size="row" />}
        <button
          type="button"
          aria-pressed={selected}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate rounded-sm px-0.5 text-left hover:bg-surface-veil"
          onClick={() => onSelect(row)}
        >
          {emitter.disabled && (
            <EyeSlashIcon
              weight="bold"
              role="img"
              aria-label={m.workshop_bin_emitter_disabled_label()}
              className="h-3 w-3 shrink-0 text-surface-400"
            />
          )}
          <CutText text={emitter.name} className="text-surface-200" />
          <span className="shrink-0 text-surface-500">[{emitter.listIndex}]</span>
          {emitter.simple && (
            <span className="shrink-0 text-meta text-surface-500">
              {m.workshop_bin_emitter_simple_label()}
            </span>
          )}
        </button>
        {row.kind === "emitter" && (
          <SoloToggle lane={emitter.index} soloed={soloed} gestures={gestures} />
        )}
      </div>

      <div className="relative h-full min-w-0 flex-1">
        <Track
          label={m.workshop_bin_timeline_lane_label({ name: emitter.name })}
          view={view}
          width={width}
          bars={bars}
          dimmed={dimmed}
          right={COUNT}
          onSeek={onSeek}
        />
        {row.kind === "emitter" && (
          <span
            data-count={emitter.index}
            aria-label={m.workshop_bin_timeline_live_label({
              count: liveCount(run.driver.histogram, emitter.index),
            })}
            className="absolute inset-y-0 right-1 flex items-center font-mono text-meta text-code text-surface-400 tabular-nums"
          >
            {liveCount(run.driver.histogram, emitter.index)}
          </span>
        )}
      </div>
    </div>
  );
});

/** The characters a SIMPLE tag takes beside an index, in the head's mono face. */
export const SIMPLE_TAG = 7;

/** What a lane head's name and index take, as characters its width is fitted to. */
export function laneLabel(emitter: EmitterModel): string {
  return `${emitter.name} [${emitter.listIndex}]${" ".repeat(emitter.simple ? SIMPLE_TAG : 0)}`;
}
