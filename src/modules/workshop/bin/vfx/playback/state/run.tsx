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

import { useContentVisible } from "@/hooks";
import type { AppError, AssetRef, BinDocumentId } from "@/lib/tauri";

import {
  type LoopRange,
  rememberedVfxRun,
  useVfxRunMemoryStore,
  vfxRunKey,
  type VfxRunMemory,
} from "../../../../state";
import type { SystemModel } from "../../engine/model/model";
import { flightTime, OPENING_RIG, type RigChoice, runLength } from "../../engine/model/rig";
import { lingerTail, systemSpan } from "../../engine/model/systemModel";
import { createDriver, type Driver } from "../../engine/simulation/driver";
import {
  ForcePreviewProvider,
  forceTopology,
  useForcePreviewState,
} from "../../forces/forcePreview";
import { useVfxSystem } from "../../hooks/useVfxSystem";

/** The seed a run opens on, so two readers of one effect see the same run. */
const FIRST_SEED = 1337;

/** The rate a run opens at, which is the effect at the speed the game plays it. */
const FIRST_SPEED = 1;

/** The most simulated time one frame spends, so a tab back from the background does not leap. */
const MAX_FRAME = 0.1;

/** One frame at the rate a seek replays at, which the step keys and buttons move by. */
export const FRAME = 1 / 60;

/** How near its span a phase counts as the run's end, in seconds, which absorbs float error. */
const END_SLACK = 1e-6;

/**
 * One particle system's run, which the shell holds above its panes (ADR-0037).
 *
 * The preview draws it and the timeline reads it. The clock is the provider's frame
 * loop, so a closed preview stops nothing.
 */
export interface VfxRun {
  readonly document: BinDocumentId;
  readonly system: SystemModel | null;
  readonly error: AppError | null;
  readonly pending: boolean;
  readonly driver: Driver;
  readonly playing: boolean;
  /**
   * The clock waits for the preview's first draw, while `playing` is unchanged.
   *
   * False by default, so a shell with no preview plays at once.
   */
  readonly warming: boolean;
  readonly speed: number;
  readonly seed: number;
  readonly rig: RigChoice;
  /** The run starts over at its end, which is the rig's life. */
  readonly looping: boolean;
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
  /** Play or pause. Play on a run paused at its end starts it from zero. */
  readonly setPlaying: (playing: boolean) => void;
  /**
   * Keep the clock at its phase while `warming`, and continue from there once it is false.
   *
   * A state setter, so its identity is stable across renders.
   */
  readonly setWarming: (warming: boolean) => void;
  readonly setSpeed: (speed: number) => void;
  /** Change the rig. A loop turned on for a run paused at its end plays it from zero. */
  readonly setRig: (rig: RigChoice) => void;
  /** Turn the rig's loop on or off, keeping its preset. */
  readonly setLooping: (looping: boolean) => void;
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
  /** Pause, and move the run to the end of its span. */
  readonly seekEnd: () => void;
  /** Move the run back to zero, leaving `playing` as it is. */
  readonly restart: () => void;
  /**
   * Pause the clock for a scrub until `endScrub`, leaving `playing` as it is.
   *
   * A second call inside one scrub does nothing.
   */
  readonly beginScrub: () => void;
  /** Let the clock run again after a scrub, if the run is playing. */
  readonly endScrub: () => void;
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
    driver === undefined ? null : Math.round(driver.phase / READOUT_STEP) * READOUT_STEP,
  );
}

export interface VfxRunProviderProps {
  document: BinDocumentId;
  /** What the document was read from, which keys the run's memory, and null to key it on the open. */
  asset: AssetRef | null;
  /** The system object, `0x` and eight hex digits. */
  entry: string;
  children: ReactNode;
}

/**
 * The run of one system, kept per system for the session (ADR-0037).
 *
 * The driver outlives the snapshot, so a re-read swaps the definition against the pool
 * the simulation already has rather than starting the effect over (2.5). A reroll is
 * the one thing that builds a new one, because the seed is the run.
 */
export function VfxRunProvider({ document, asset, entry, children }: VfxRunProviderProps) {
  const { system: authoredSystem, error, pending } = useVfxSystem(document, entry);
  const forces = useForcePreviewState();
  const { project: projectForces, clear: clearForces } = forces;
  const system = useMemo(
    () => (authoredSystem === null ? null : projectForces(authoredSystem)),
    [authoredSystem, projectForces],
  );
  const topology = forceTopology(authoredSystem);
  useEffect(() => {
    clearForces();
  }, [topology, clearForces]);
  const visible = useContentVisible();
  const key = vfxRunKey(asset ?? document, entry);
  const [kept] = useState(() => rememberedVfxRun(key));

  const [playing, setPlayingState] = useState(true);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [warming, setWarming] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const [seed, setSeed] = useState(kept?.seed ?? FIRST_SEED);
  const [speed, setSpeed] = useState(kept?.speed ?? FIRST_SPEED);
  const [rig, setRigState] = useState<RigChoice>(kept?.rig ?? OPENING_RIG);
  const [muted, setMuted] = useState<ReadonlySet<number>>(() => new Set(kept?.muted));
  const [soloed, setSoloed] = useState<ReadonlySet<number>>(() => new Set(kept?.soloed));
  const [loop, setLoop] = useState<LoopRange | null>(kept?.loop ?? null);
  const [fitRequest, setFitRequest] = useState(0);
  const [pinned, setPinned] = useState<number | null>(kept?.pinned ?? null);
  const looping = rig.rig.life === "loop";

  const driver = useMemo(() => createDriver(seed), [seed]);
  const span = useMemo(
    () =>
      system === null
        ? 1
        : runLength(
            rig.rig.motion,
            systemSpan(system),
            lingerTail(system, flightTime(rig.rig.motion)),
          ),
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

  const previousForceProjection = useRef(forces.project);
  useEffect(() => {
    if (system === null) {
      return;
    }

    const time = driver.phase;
    driver.swap(system);
    if (!playingRef.current || previousForceProjection.current !== forces.project) {
      driver.seek(time);
    }
    previousForceProjection.current = forces.project;

    notify();
  }, [driver, system, notify, forces.project]);

  /* A loop turned off leaves the clock at the sum of every pass it made, which a rig that
     plays once reads as past its span, so the run returns to the phase it showed. */
  const steered = useRef(rig.rig);
  useEffect(() => {
    const phase = driver.phase;
    const unlooped = steered.current.life === "loop" && rig.rig.life !== "loop";
    steered.current = rig.rig;

    driver.steer(rig.rig);
    if (unlooped && driver.phase > phase + END_SLACK) driver.seek(phase);
    notify();
  }, [driver, rig, notify]);

  useEffect(() => {
    driver.pin(pinned);
  }, [driver, pinned]);

  /* A kept run resumes where its tab left it, once the system it is a run of has landed.
     One left at or past its end opens at zero. */
  const resumeAt = useRef(kept?.playhead ?? null);
  useEffect(() => {
    const at = resumeAt.current;
    if (system === null || at === null) return;

    resumeAt.current = null;
    if (reachedEnd(at, span)) return;

    driver.seek(at);
    notify();
  }, [driver, system, span, notify]);

  /* Read through a ref by the loop below, so a speed tick or a rig drag, which moves the
     span, changes the next frame rather than restarting the loop and dropping one. */
  const pace = useRef({ speed, loop, span, looping });
  pace.current = { speed, loop, span, looping };
  /* An edit hands over a new system, and restarting the loop on it drops a frame of time. */
  const loaded = system !== null;
  useEffect(() => {
    if (!visible || !playing || !loaded || warming || scrubbing) return;

    let last: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      if (dt > 0) {
        const { speed: rate, loop: range, span: length, looping: loops } = pace.current;
        const room = range === null && !loops ? length - driver.phase : Infinity;
        const spent = Math.min(dt * rate, room);
        if (spent > 0) driver.advance(spent);
        if (range !== null && driver.phase >= Math.min(range.to, length)) driver.seek(range.from);
        notify();

        if (spent >= room) {
          setPlayingState(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [driver, playing, loaded, notify, visible, warming, scrubbing]);

  /* Written on the way out rather than as it changes, off the values the last render
     read, so the store hears one memory per tab rather than one per frame. */
  const latest = useRef<{ memory: Omit<VfxRunMemory, "playhead">; driver: Driver; span: number }>(
    null!,
  );
  latest.current = {
    memory: { seed, rig, speed, muted: [...muted], soloed: [...soloed], loop, pinned },
    driver,
    span,
  };
  const remember = useVfxRunMemoryStore((s) => s.remember);
  useEffect(
    () => () => {
      const { memory, driver: last, span: length } = latest.current;
      const phase = last.phase;
      remember(key, { ...memory, playhead: reachedEnd(phase, length) ? 0 : phase });
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
      setPlayingState(false);
      seek(driver.phase + frames * FRAME);
    },
    [driver, seek],
  );
  const seekEnd = useCallback(() => {
    const { span: length, looping: loops } = pace.current;
    const end = loops ? Math.max(length - FRAME, 0) : length;
    setPlayingState(false);

    /* A seek lands on whole replay steps, so the last part of a frame is advanced. */
    driver.seek(end);
    const gap = end - driver.phase;
    if (gap > 0 && gap < FRAME) driver.advance(gap);
    notify();
  }, [driver, notify]);

  /* Paused at its end: no loop or range starts the run over. */
  const parked = useCallback(() => {
    const { loop: range, span: length, looping: loops } = pace.current;
    return !loops && range === null && reachedEnd(driver.phase, length);
  }, [driver]);
  const setPlaying = useCallback(
    (next: boolean) => {
      if (next && parked()) restart();
      setPlayingState(next);
    },
    [parked, restart],
  );
  const setRig = useCallback(
    (next: RigChoice) => {
      if (next.rig.life === "loop" && parked()) {
        restart();
        setPlayingState(true);
      }
      setRigState(next);
    },
    [parked, restart],
  );

  const beginScrub = useCallback(() => setScrubbing(true), []);
  const endScrub = useCallback(() => setScrubbing(false), []);

  const run = useMemo<VfxRun>(
    () => ({
      document,
      system,
      error,
      pending,
      driver,
      playing,
      warming,
      speed,
      seed,
      rig,
      looping,
      muted,
      soloed,
      loop,
      pinned,
      span,
      resumed: (kept?.playhead ?? 0) > 0,
      fitRequest,
      requestFit: () => setFitRequest((count) => count + 1),
      setPlaying,
      setWarming,
      setSpeed,
      setRig,
      setLooping: (next) =>
        setRig({ preset: rig.preset, rig: { ...rig.rig, life: next ? "loop" : "once" } }),
      reroll: () => setSeed((current) => current + 1),
      toggleMuted: (emitter) => setMuted((current) => toggled(current, emitter)),
      toggleSoloed: (emitter) => setSoloed((current) => toggled(current, emitter)),
      setMuted,
      setSoloed,
      setLoop: (range) => setLoop(boundedLoop(range, span)),
      setPinned,
      seek,
      step,
      seekEnd,
      restart,
      beginScrub,
      endScrub,
      subscribe,
    }),
    [
      document,
      system,
      error,
      pending,
      driver,
      playing,
      warming,
      speed,
      seed,
      rig,
      looping,
      muted,
      soloed,
      loop,
      pinned,
      span,
      kept,
      fitRequest,
      setPlaying,
      setRig,
      seek,
      step,
      seekEnd,
      restart,
      beginScrub,
      endScrub,
      subscribe,
    ],
  );

  return (
    <ForcePreviewProvider value={forces}>
      <VfxRunContext value={run}>{children}</VfxRunContext>
    </ForcePreviewProvider>
  );
}

/** `phase` has reached the end of a run `span` seconds long. */
function reachedEnd(phase: number, span: number): boolean {
  return phase >= span - END_SLACK;
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
