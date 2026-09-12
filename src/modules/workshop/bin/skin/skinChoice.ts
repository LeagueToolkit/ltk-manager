import { createContext, useCallback, useMemo, useState } from "react";

import { createSceneClock, type SceneClock } from "@/modules/viewport";

/**
 * What a reader chose in a skin's preview, and the clock it plays on.
 *
 * Held by the view rather than by the preview, so a change of frame, which mounts the
 * preview somewhere else, keeps the clip, the transport and the time it stood at.
 */
export interface SkinChoice {
  readonly clock: SceneClock;
  /** The clip the reader picked, a hash or `BIND_POSE`, and null before they pick one. */
  readonly picked: string | null;
  readonly setPicked: (clip: string | null) => void;
  readonly playing: boolean;
  readonly setPlaying: (playing: boolean) => void;
  readonly speed: number;
  readonly setSpeed: (speed: number) => void;
  /** The idle effects are drawn. */
  readonly effects: boolean;
  readonly setEffects: (effects: boolean) => void;
  /** The submesh a reader points at, from the inspector or the viewport, and null for none. */
  readonly submesh: string | null;
  readonly setSubmesh: (submesh: string | null) => void;
  /** Counts the viewport's picks, so the row of a submesh picked twice scrolls in again. */
  readonly picks: number;
  /** Point at `submesh` from the viewport, which also brings its row into view. */
  readonly pickSubmesh: (submesh: string | null) => void;
}

/** The rate a clip opens at, which is the speed the game plays it. */
const FIRST_SPEED = 1;

/** A preview's choices as a reader first meets them: playing, at speed, with everything drawn. */
export function useSkinChoice(): SkinChoice {
  const clock = useMemo(createSceneClock, []);
  const [picked, setPicked] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(FIRST_SPEED);
  const [effects, setEffects] = useState(true);
  const [submesh, setSubmesh] = useState<string | null>(null);
  const [picks, setPicks] = useState(0);
  const pickSubmesh = useCallback((next: string | null) => {
    setSubmesh(next);
    setPicks((count) => count + 1);
  }, []);

  return useMemo(
    () => ({
      clock,
      picked,
      setPicked,
      playing,
      setPlaying,
      speed,
      setSpeed,
      effects,
      setEffects,
      submesh,
      setSubmesh,
      picks,
      pickSubmesh,
    }),
    [clock, picked, playing, speed, effects, submesh, picks, pickSubmesh],
  );
}

/** Whether two submesh names are one, which the `.skn` and a bin spell in either case. */
export function sameSubmesh(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/** The view's choices, which a preview mounted under it reads in place of its own. */
export const SkinChoiceContext = createContext<SkinChoice | null>(null);
