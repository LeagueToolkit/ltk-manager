import { EyeClosedIcon, EyeIcon } from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";

import { laneSpan, painted, shownAlone, soloAlone } from "./laneModel";
import { useVfxRun } from "./run";

/** Which of a lane's two visibility toggles a gesture is on. */
export type LaneColumn = "visible" | "solo";

/** What every lane's toggles answer a press, a drag over them and a key with. */
export interface LaneGestures {
  readonly press: (column: LaneColumn, lane: number, event: ReactPointerEvent) => void;
  readonly pass: (column: LaneColumn, lane: number, event: ReactPointerEvent) => void;
  readonly flip: (column: LaneColumn, lane: number) => void;
}

/**
 * The lanes' visibility gestures, "The timeline" in docs/ux/BIN_EDITOR.md.
 *
 * `drawn` is the lanes in the order they are listed, which a Shift range walks, and `every`
 * the system's emitters, of which Alt shows one alone.
 */
export function useLaneGestures(drawn: readonly number[], every: readonly number[]): LaneGestures {
  const { muted, soloed, setMuted, setSoloed } = useVfxRun();
  const stroke = useRef<{ column: LaneColumn; member: boolean } | null>(null);
  const anchor = useRef<{ column: LaneColumn; lane: number; member: boolean } | null>(null);
  /* Read at the press through a ref, so a toggle changes no handler and no lane row
     re-renders for it. */
  const sets = useRef({ muted, soloed });
  sets.current = { muted, soloed };

  useEffect(() => {
    const end = () => {
      stroke.current = null;
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  return useMemo(() => {
    const setOf = (column: LaneColumn) => (column === "visible" ? setMuted : setSoloed);
    return {
      press: (column, lane, event) => {
        if (event.button !== 0) return;
        const set = setOf(column);
        if (event.altKey) {
          set((held) =>
            column === "visible" ? shownAlone(held, lane, every) : soloAlone(held, lane),
          );
          return;
        }
        const from = anchor.current;
        if (event.shiftKey && from !== null && from.column === column) {
          set((held) => painted(held, laneSpan(drawn, from.lane, lane), from.member));
          return;
        }
        const { muted: hidden, soloed: alone } = sets.current;
        const member = !(column === "visible" ? hidden : alone).has(lane);
        anchor.current = { column, lane, member };
        stroke.current = { column, member };
        set((held) => painted(held, [lane], member));
      },
      pass: (column, lane, event) => {
        const held = stroke.current;
        if (held === null || held.column !== column || (event.buttons & 1) === 0) return;
        setOf(column)((set) => painted(set, [lane], held.member));
      },
      flip: (column, lane) => setOf(column)((held) => painted(held, [lane], !held.has(lane))),
    };
  }, [drawn, every, setMuted, setSoloed]);
}

/* DS-RADIUS, DS-VEIL */
const TOGGLE =
  "flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-veil hover:text-surface-100";

/** The handlers one lane's toggle hands its gestures. A key's click carries no pointer. */
function gestureHandlers(column: LaneColumn, lane: number, gestures: LaneGestures) {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) =>
      gestures.press(column, lane, event),
    onPointerOver: (event: ReactPointerEvent<HTMLButtonElement>) =>
      gestures.pass(column, lane, event),
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) gestures.flip(column, lane);
    },
  };
}

interface ToggleProps {
  lane: number;
  gestures: LaneGestures;
}

/** A lane's eye: open while the emitter draws, shut while it is hidden. */
export function VisibleToggle({ lane, hidden, gestures }: ToggleProps & { hidden: boolean }) {
  return (
    <button
      type="button"
      aria-label={m.workshop_bin_timeline_visible_label()}
      aria-pressed={!hidden}
      title={m.workshop_bin_timeline_visibility_hint()}
      className={twMerge(TOGGLE, hidden ? "text-surface-500" : "text-surface-300")}
      {...gestureHandlers("visible", lane, gestures)}
    >
      {!hidden && <EyeIcon weight="bold" className="h-3.5 w-3.5" />}
      {hidden && <EyeClosedIcon weight="bold" className="h-3.5 w-3.5" />}
    </button>
  );
}

/** A lane's solo, one letter wide. */
export function SoloToggle({ lane, soloed, gestures }: ToggleProps & { soloed: boolean }) {
  return (
    <button
      type="button"
      aria-label={m.workshop_bin_preview_solo_label()}
      aria-pressed={soloed}
      title={m.workshop_bin_timeline_visibility_hint()}
      className={twMerge(
        TOGGLE,
        "font-sans text-meta font-semibold text-surface-400",
        soloed && "bg-accent-500/30 text-accent-200",
      )}
      {...gestureHandlers("solo", lane, gestures)}
    >
      S
    </button>
  );
}

/** Over the lane heads: every lane shown or hidden at once, and every solo cleared. */
export function VisibilityHeader({ every }: { every: readonly number[] }) {
  const { muted, soloed, setMuted, setSoloed } = useVfxRun();
  const shown = muted.size === 0;

  return (
    <div data-ui="Lanes:header" className="flex h-full items-center gap-1 px-1 select-none">
      <span className="w-4 shrink-0" />
      <button
        type="button"
        aria-label={m.workshop_bin_timeline_visible_all_label()}
        aria-pressed={shown}
        className={twMerge(TOGGLE, shown ? "text-surface-300" : "text-surface-500")}
        onClick={() => setMuted(() => (shown ? new Set(every) : new Set()))}
      >
        {shown && <EyeIcon weight="bold" className="h-3.5 w-3.5" />}
        {!shown && <EyeClosedIcon weight="bold" className="h-3.5 w-3.5" />}
      </button>
      <span className="min-w-0 flex-1" />
      <button
        type="button"
        aria-label={m.workshop_bin_timeline_solo_clear_action()}
        disabled={soloed.size === 0}
        className={twMerge(
          TOGGLE,
          "font-sans text-meta font-semibold text-surface-400 disabled:cursor-default disabled:opacity-40",
        )}
        onClick={() => setSoloed(() => new Set())}
      >
        S
      </button>
    </div>
  );
}
