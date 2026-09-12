import { createContext, useMemo, useState } from "react";

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
    }),
    [clock, picked, playing, speed, effects],
  );
}

/** The view's choices, which a preview mounted under it reads in place of its own. */
export const SkinChoiceContext = createContext<SkinChoice | null>(null);
