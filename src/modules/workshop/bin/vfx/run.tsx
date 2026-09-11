import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { AppError, BinDocumentId } from "@/lib/tauri";

import {
  type LoopRange,
  rememberedVfxRun,
  useVfxRunMemoryStore,
  vfxRunKey,
  type VfxRunMemory,
} from "../../state";
import { createDriver, type Driver } from "./driver";
import type { SystemModel } from "./model";
import { FIRST_RIG, type RigChoice, runLength } from "./rig";
import { lingerTail, systemSpan } from "./systemModel";
import { useVfxSystem } from "./useVfxSystem";

/** The seed a run opens on, so two readers of one effect see the same run. */
const FIRST_SEED = 1337;

/** The rate a run opens at, which is the effect at the speed the game plays it. */
const FIRST_SPEED = 1;

/** The most simulated time one frame spends, so a tab back from the background does not leap. */
const MAX_FRAME = 0.1;

/** One frame at the rate a seek replays at, which the step keys and buttons move by. */
export const FRAME = 1 / 60;

/**
 * One particle system's run, which the shell holds above its panes (ADR-0037).
 *
 * The preview draws it and the timeline reads it. The clock is the provider's frame
 * loop, so a closed preview stops nothing.
 */
export interface VfxRun {
  readonly system: SystemModel | null;
  readonly error: AppError | null;
  readonly pending: boolean;
  readonly driver: Driver;
  readonly playing: boolean;
  readonly speed: number;
  readonly seed: number;
  readonly rig: RigChoice;
  /** Emitters of the opened system that draw nothing, by pool index. */
  readonly muted: ReadonlySet<number>;
  /** Emitters of the opened system that alone draw while any is in the set, by pool index. */
  readonly soloed: ReadonlySet<number>;
  readonly loop: LoopRange | null;
  /** The chance every birth reads its tables at, null for a run left to its own draws. */
  readonly pinned: number | null;
  /** Seconds one run lasts, which the playhead spans. */
  readonly span: number;
  /** The run opened where a kept tab left it rather than at zero. */
  readonly resumed: boolean;
  /** Bumped per Fit asked of the camera, which the viewport answers. A second ask is a second fit. */
  readonly fitRequest: number;
  readonly requestFit: () => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly setSpeed: (speed: number) => void;
  readonly setRig: (rig: RigChoice) => void;
  readonly reroll: () => void;
  readonly toggleMuted: (emitter: number) => void;
  readonly toggleSoloed: (emitter: number) => void;
  /** Rewrite the muted set from the one held, which a stroke across the lanes does per lane. */
  readonly setMuted: (update: (held: ReadonlySet<number>) => ReadonlySet<number>) => void;
  readonly setSoloed: (update: (held: ReadonlySet<number>) => ReadonlySet<number>) => void;
  readonly setLoop: (loop: LoopRange | null) => void;
  readonly setPinned: (chance: number | null) => void;
  /** Stand the run `time` seconds into its phase. */
  readonly seek: (time: number) => void;
  /** Pause, and move the run by whole frames. */
  readonly step: (frames: number) => void;
  readonly restart: () => void;
  /** Hear the clock, which moves every frame the run plays and on every seek. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** The run of the enclosing shell, which a test stands a run of its own in. */
export const VfxRunContext = createContext<VfxRun | null>(null);

/** The run of the shell the caller sits in. */
export function useVfxRun(): VfxRun {
  const run = use(VfxRunContext);
  if (run === null) throw new Error("useVfxRun outside a VfxRunProvider");
  return run;
}

/** How often a readout of the clock catches up with it, in milliseconds. */
const READOUT_MS = 100;

/** The finest step a readout tells apart, which is what its two decimals show. */
const READOUT_STEP = 0.01;

/**
 * Where the run stands, in seconds of its phase, caught up with every `READOUT_MS`.
 *
 * The clock moves every frame and a readout is React state, so the two are kept apart:
 * a listener hears the clock at the readout's own rate, with one trailing call so a seek
 * that lands between two ticks still reaches it.
 */
export function useRunClock(): number {
  return useClockOf(useVfxRun()) ?? 0;
}

/** `useRunClock` for a caller that may sit outside a run, which hears nothing and reads null. */
export function useClockOf(run: VfxRun | null): number | null {
  const subscribe = run?.subscribe;
  const driver = run?.driver;
  const paced = useCallback(
    (listener: () => void) => {
      if (subscribe === undefined) return () => {};
      let last = 0;
      let trailing = 0;
      const unsubscribe = subscribe(() => {
        const now = performance.now();
        const wait = READOUT_MS - (now - last);
        if (wait <= 0) {
          last = now;
          listener();
          return;
        }
        if (trailing === 0) {
          trailing = window.setTimeout(() => {
            trailing = 0;
            last = performance.now();
            listener();
          }, wait);
        }
      });
      return () => {
        unsubscribe();
        window.clearTimeout(trailing);
      };
    },
    [subscribe],
  );
  return useSyncExternalStore(paced, () =>
    driver === undefined ? null : Math.round(driver.elapsed / READOUT_STEP) * READOUT_STEP,
  );
}

export interface VfxRunProviderProps {
  document: BinDocumentId;
  /** The system object, `0x` and eight hex digits. */
  entry: string;
  children: ReactNode;
}

/**
 * The run of one system, kept per system for the session (ADR-0037).
 *
 * The driver outlives the snapshot, so a re-read swaps the definition against the pool
 * the simulation already holds rather than starting the effect over (2.5). A reroll is
 * the one thing that builds a new one, because the seed is the run.
 */
export function VfxRunProvider({ document, entry, children }: VfxRunProviderProps) {
  const { system, error, pending } = useVfxSystem(document, entry);
  const key = vfxRunKey(document, entry);
  const [kept] = useState(() => rememberedVfxRun(key));

  const [playing, setPlaying] = useState(true);
  const [seed, setSeed] = useState(kept?.seed ?? FIRST_SEED);
  const [speed, setSpeed] = useState(kept?.speed ?? FIRST_SPEED);
  const [rig, setRig] = useState<RigChoice>(kept?.rig ?? FIRST_RIG);
  const [muted, setMuted] = useState<ReadonlySet<number>>(() => new Set(kept?.muted));
  const [soloed, setSoloed] = useState<ReadonlySet<number>>(() => new Set(kept?.soloed));
  const [loop, setLoop] = useState<LoopRange | null>(kept?.loop ?? null);
  const [fitRequest, setFitRequest] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);

  const driver = useMemo(() => createDriver(seed), [seed]);
  const span = useMemo(
    () => (system === null ? 1 : runLength(rig.rig.motion, systemSpan(system), lingerTail(system))),
    [system, rig],
  );

  const listeners = useRef(new Set<() => void>());
  const notify = useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (system === null) return;
    driver.swap(system);
    notify();
  }, [driver, system, notify]);

  useEffect(() => {
    driver.steer(rig.rig);
    notify();
  }, [driver, rig, notify]);

  useEffect(() => {
    driver.pin(pinned);
  }, [driver, pinned]);

  /* A kept run resumes where its tab left it, once the system it is a run of has landed. */
  const resumeAt = useRef(kept?.playhead ?? null);
  useEffect(() => {
    if (system === null || resumeAt.current === null) return;
    driver.seek(resumeAt.current);
    resumeAt.current = null;
    notify();
  }, [driver, system, notify]);

  /* Read through a ref by the loop below, so a speed tick or a rig drag, which moves the
     span, changes the next frame rather than restarting the loop and dropping one. */
  const pace = useRef({ speed, loop, span });
  pace.current = { speed, loop, span };
  useEffect(() => {
    if (!playing || system === null) return;
    let last: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      if (dt > 0) {
        const { speed: rate, loop: range, span: length } = pace.current;
        driver.advance(dt * rate);
        if (range !== null && driver.elapsed >= Math.min(range.to, length)) driver.seek(range.from);
        notify();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [driver, playing, system, notify]);

  /* Written on the way out rather than as it changes, off the values the last render
     held, so the store hears one memory per tab rather than one per frame. */
  const latest = useRef<{ memory: Omit<VfxRunMemory, "playhead">; driver: Driver }>(null!);
  latest.current = {
    memory: { seed, rig, speed, muted: [...muted], soloed: [...soloed], loop },
    driver,
  };
  const remember = useVfxRunMemoryStore((s) => s.remember);
  useEffect(
    () => () => {
      const { memory, driver: held } = latest.current;
      remember(key, { ...memory, playhead: held.elapsed });
    },
    [key, remember],
  );

  const seek = useCallback(
    (time: number) => {
      driver.seek(Math.max(time, 0));
      notify();
    },
    [driver, notify],
  );
  const restart = useCallback(() => {
    driver.restart();
    notify();
  }, [driver, notify]);
  const step = useCallback(
    (frames: number) => {
      setPlaying(false);
      seek(driver.elapsed + frames * FRAME);
    },
    [driver, seek],
  );

  const run = useMemo<VfxRun>(
    () => ({
      system,
      error,
      pending,
      driver,
      playing,
      speed,
      seed,
      rig,
      muted,
      soloed,
      loop,
      pinned,
      span,
      resumed: (kept?.playhead ?? 0) > 0,
      fitRequest,
      requestFit: () => setFitRequest((held) => held + 1),
      setPlaying,
      setSpeed,
      setRig,
      reroll: () => setSeed((held) => held + 1),
      toggleMuted: (emitter) => setMuted((held) => toggled(held, emitter)),
      toggleSoloed: (emitter) => setSoloed((held) => toggled(held, emitter)),
      setMuted,
      setSoloed,
      setLoop: (range) => setLoop(boundedLoop(range, span)),
      setPinned,
      seek,
      step,
      restart,
      subscribe,
    }),
    [
      system,
      error,
      pending,
      driver,
      playing,
      speed,
      seed,
      rig,
      muted,
      soloed,
      loop,
      pinned,
      span,
      kept,
      fitRequest,
      seek,
      step,
      restart,
      subscribe,
    ],
  );

  return <VfxRunContext value={run}>{children}</VfxRunContext>;
}

/** `range` held inside the run's span, and null for one with nothing left between its ends. */
function boundedLoop(range: LoopRange | null, span: number): LoopRange | null {
  if (range === null) return null;
  const from = Math.max(range.from, 0);
  const to = Math.min(range.to, span);
  return to <= from ? null : { from, to };
}

/** `held` with `member` added, or taken out where it already is. */
export function toggled(held: ReadonlySet<number>, member: number): ReadonlySet<number> {
  const next = new Set(held);
  if (next.has(member)) next.delete(member);
  else next.add(member);
  return next;
}
