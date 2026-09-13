import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useResizeObserver } from "@/hooks";
import { m } from "@/i18n";
import { useTimelineHistogram } from "@/stores";

import { useEmitters } from "../emitterChoice";
import { nameColumn } from "../textCut";
import { drawHistogram, writeCounts } from "./histogram";
import { childLanes, laneOrder, matchingLanes, timeAt, xOf } from "./laneModel";
import { COUNT, laneLabel, LaneRow, type Row } from "./LaneRow";
import { useLaneGestures, VisibilityHeader } from "./laneVisibility";
import type { EmitterModel } from "./model";
import { PastRun, Ruler } from "./Ruler";
import { toggled, useVfxRun } from "./run";
import { useLaneView } from "./useLaneView";

/** One lane's height in pixels, which the histogram canvas is laid out by. */
const ROW = 24;

/** What a lane head holds beside its name and index, in pixels: the caret, square, M and S. */
const HEAD_EXTRA = 104;

/** The share of the pane past which a lane head cuts its names. */
const HEAD_CAP = 1 / 3;

/** How often the counts and the histogram redraw while the run plays, in milliseconds. */
const REDRAW_MS = 100;

/** The token the histogram is painted in, resolved off the canvas. */
const HISTOGRAM_TOKEN = "--color-accent-400";

/** The width of the time chip on the playhead and the pointer's line, in pixels. */
const FLAG = 36;

/** Stand `chip` over `x`, held inside the ruler's `width` so it never clips at an end. */
function placeChip(chip: HTMLElement, x: number, width: number): void {
  const offset = Math.min(Math.max(-FLAG / 2, -x), width - x - FLAG);
  chip.style.transform = `translateX(${offset}px)`;
}

/** Show or hide a line that stands at `x`, with its chip reading `time`. */
function standLine(
  lines: readonly (HTMLElement | null)[],
  chip: HTMLElement | null,
  x: number,
  width: number,
  time: number,
): void {
  const shown = x >= 0 && x <= width;
  for (const line of lines) {
    if (line === null) continue;
    line.style.visibility = shown ? "visible" : "hidden";
    line.style.transform = `translateX(${x}px)`;
  }
  if (chip === null || !shown) return;
  chip.textContent = time.toFixed(2);
  placeChip(chip, x, width);
}

/**
 * One lane per emitter under one playhead, "The timeline" in docs/ux/BIN_EDITOR.md.
 *
 * The bars and the heads are the DOM's, and the histogram is one canvas over the tracks,
 * redrawn at `REDRAW_MS` off the run's clock. The playhead, its flag, the pointer's line and
 * the live counts are written to the DOM outside React's render, and a row re-renders on a
 * change of its own.
 */
export function Lanes() {
  const run = useVfxRun();
  const { system, driver, span, loop, seek, setLoop, subscribe } = run;
  const { cards, filter, chooseCard, chooseChild } = useEmitters();
  const histogram = useTimelineHistogram();

  const [width, setWidth] = useState(0);
  const measure = useResizeObserver<HTMLDivElement>((element) => setWidth(element.clientWidth));
  const [pane, setPane] = useState(0);
  const measurePane = useResizeObserver<HTMLDivElement>((element) => setPane(element.clientWidth));
  /* A cap in pixels rather than a share, so the ruler's row and the scrolled rows under it,
     which a scrollbar narrows, draw one width. */
  const head = useMemo(
    () =>
      nameColumn(
        system === null ? [] : laneOrder(system).map(laneLabel),
        HEAD_EXTRA,
        pane > 0 ? `${Math.round(pane * HEAD_CAP)}px` : `${HEAD_CAP * 100}%`,
      ),
    [system, pane],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  /* How many children the pass has spawned, which is what moves a child lane's bars. */
  const [spawned, setSpawned] = useState(0);

  const rows = useMemo<Row[]>(() => {
    if (system === null) return [];
    return matchingLanes(laneOrder(system), filter).flatMap((emitter) => {
      const nested = childLanes(emitter);
      const own: Row = { kind: "emitter", emitter, nested: nested.length > 0 };
      if (!expanded.has(emitter.index)) return [own];
      return [own, ...nested.map((lane): Row => ({ kind: "child", lane, parent: emitter }))];
    });
  }, [system, filter, expanded]);
  const every = useMemo(
    () => (system === null ? [] : laneOrder(system).map((emitter) => emitter.index)),
    [system],
  );
  const listed = useMemo(
    () => rows.flatMap((row) => (row.kind === "emitter" ? [row.emitter.index] : [])),
    [rows],
  );
  const gestures = useLaneGestures(listed, every);

  const cardOf = useCallback(
    (emitter: EmitterModel) =>
      cards.find((card) => card.simple === emitter.simple && card.index === emitter.listIndex),
    [cards],
  );
  const select = useCallback(
    (row: Row) => {
      if (row.kind === "child") {
        chooseChild({
          path: row.lane.path,
          parent: cardOf(row.parent)?.key ?? null,
          system: row.lane.system,
          emitter: row.lane.emitter,
        });
        return;
      }
      const card = cardOf(row.emitter);
      if (card !== undefined) chooseCard(card.key);
    },
    [cardOf, chooseCard, chooseChild],
  );
  const expand = useCallback((index: number) => setExpanded((held) => toggled(held, index)), []);

  /* The playhead and its flag follow every frame, and the counts and the histogram every
     `REDRAW_MS`. The paint colour is read once here rather than per redraw, since a computed
     style forces the document's styles to settle first. */
  const body = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const flag = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(0);
  const { view, refit } = useLaneView(span, body, width);
  useEffect(() => {
    const colour =
      canvas.current === null
        ? ""
        : getComputedStyle(canvas.current).getPropertyValue(HISTOGRAM_TOKEN).trim();
    const paint = () => {
      const x = xOf(view, width, driver.phase);
      standLine([playhead.current, flag.current], chip.current, x, width, driver.phase);
      const now = performance.now();
      if (now - drawn.current < REDRAW_MS) return;
      drawn.current = now;
      drawHistogram(canvas.current, colour, driver.histogram, {
        lanes: rows.map((row) => (row.kind === "emitter" ? row.emitter.index : null)),
        row: ROW,
        view,
        width,
      });
      writeCounts(body.current, driver.histogram);
      setSpawned(driver.births().length);
    };
    drawn.current = 0;
    paint();
    return subscribe(paint);
  }, [subscribe, driver, rows, view, width]);

  const seekAt = useCallback(
    (x: number) => seek(Math.max(timeAt(view, width, x), 0)),
    [seek, view, width],
  );

  /* The pointer's line reads where a press would seek, over the ruler and every lane. */
  const tracks = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const ghostFlag = useRef<HTMLDivElement>(null);
  const ghostChip = useRef<HTMLSpanElement>(null);
  const trackX = (event: ReactPointerEvent) =>
    event.clientX - (tracks.current?.getBoundingClientRect().left ?? 0);
  const hover = (event: ReactPointerEvent) => {
    const x = trackX(event);
    standLine(
      [ghost.current, ghostFlag.current],
      ghostChip.current,
      x,
      width,
      timeAt(view, width, x),
    );
  };
  const unhover = () => standLine([ghost.current, ghostFlag.current], null, -1, width, 0);

  /* The flag is the ruler's scrub handle, where a drag on the open ruler sets a loop. */
  const scrubbing = useRef(false);

  return (
    <div
      ref={body}
      data-ui="Lanes"
      className="flex min-h-0 flex-1 flex-col"
      onPointerMove={hover}
      onPointerLeave={unhover}
    >
      <div ref={measurePane} className="flex h-5 shrink-0 border-b border-surface-700/50">
        <div
          className="shrink-0 border-r border-surface-700/50 font-mono text-code"
          style={{ width: head }}
        >
          <VisibilityHeader every={every} />
        </div>
        <div className="relative min-w-0 flex-1">
          <span className="absolute inset-y-0 right-1 flex items-end pb-px text-meta leading-none text-surface-500 select-none">
            {m.workshop_bin_timeline_live_caption_label()}
          </span>
          <div
            ref={measure}
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{ right: COUNT }}
          >
            <Ruler
              view={view}
              width={width}
              span={span}
              loop={loop}
              onSeek={seekAt}
              onLoop={setLoop}
              onRefit={refit}
            />
            <div
              ref={ghostFlag}
              aria-hidden="true"
              className="pointer-events-none invisible absolute inset-y-0 left-0 border-l border-dashed border-surface-400/60"
            >
              <span
                ref={ghostChip}
                className="absolute top-px left-0 flex h-3.5 items-center justify-center rounded-sm bg-surface-700 font-mono text-meta leading-none text-surface-200 tabular-nums"
                style={{ width: FLAG }}
              />
            </div>
            <div
              ref={flag}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accent-400"
            >
              <span
                ref={chip}
                data-ui="Lanes:flag"
                /* DS-INVARIANT */
                className="pointer-events-auto absolute top-px left-0 flex h-3.5 cursor-ew-resize touch-none items-center justify-center rounded-sm bg-accent-500 font-mono text-meta leading-none text-brand-on tabular-nums shadow-sm"
                style={{ width: FLAG }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  scrubbing.current = true;
                }}
                onPointerMove={(event) => {
                  if (scrubbing.current) seekAt(trackX(event));
                }}
                onPointerUp={() => {
                  scrubbing.current = false;
                }}
                onPointerCancel={() => {
                  scrubbing.current = false;
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* DS-SCROLLBAR */}
      <div className="relative min-h-0 flex-1 overflow-y-auto scrollbar-md">
        <div className="relative" style={{ height: rows.length * ROW }}>
          {rows.map((row) => (
            <LaneRow
              key={
                row.kind === "emitter"
                  ? `${row.emitter.index}`
                  : `${row.lane.path}:${row.lane.emitter.index}`
              }
              row={row}
              view={view}
              width={width}
              head={head}
              gestures={gestures}
              card={row.kind === "emitter" ? cardOf(row.emitter) : undefined}
              spawned={row.kind === "child" ? spawned : 0}
              expanded={row.kind === "emitter" && expanded.has(row.emitter.index)}
              onExpand={expand}
              onSelect={select}
              onSeek={seekAt}
            />
          ))}
          <div
            ref={tracks}
            className="pointer-events-none absolute inset-y-0 overflow-hidden font-mono text-code"
            style={{ left: head, right: COUNT }}
            aria-hidden="true"
          >
            <PastRun x={xOf(view, width, span)} width={width} />
            {loop !== null && (
              <div
                className="absolute inset-y-0 bg-accent-500/5"
                style={{
                  left: xOf(view, width, loop.from),
                  width: Math.max(xOf(view, width, loop.to) - xOf(view, width, loop.from), 0),
                }}
              />
            )}
            {histogram && (
              <canvas
                ref={canvas}
                className="absolute top-0 left-0 opacity-70"
                style={{ width, height: rows.length * ROW }}
              />
            )}
            <div
              ref={ghost}
              className="invisible absolute inset-y-0 left-0 border-l border-dashed border-surface-400/50"
            />
            <div
              ref={playhead}
              className="absolute inset-y-0 left-0 w-px bg-accent-400 shadow-[0_0_6px_var(--color-accent-500)]"
              style={{ transform: `translateX(${xOf(view, width, driver.phase)}px)` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
