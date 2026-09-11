import type { RefObject } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import type { SceneClock } from "@/modules/viewport";

import { FRAME } from "../vfx/run";
import { speedDetent } from "../vfx/Transport";

/** How many frames Shift and an arrow move, which is a tenth of a second. */
const SHIFT_FRAMES = 6;

/** What a key reaches of a skin's preview: its clock, its transport and its camera. */
export interface SkinKeys {
  readonly clock: SceneClock;
  readonly playing: boolean;
  readonly setPlaying: (playing: boolean) => void;
  readonly speed: number;
  readonly setSpeed: (speed: number) => void;
  /** Frame the character, which the Fit button asks for too. */
  readonly fit: () => void;
}

/** What each key does to the preview, "The keys" in docs/ux/BIN_EDITOR.md. */
const KEYS: Record<string, (keys: SkinKeys) => void> = {
  space: (keys) => keys.setPlaying(!keys.playing),
  left: (keys) => step(keys, -1),
  right: (keys) => step(keys, 1),
  "shift+left": (keys) => step(keys, -SHIFT_FRAMES),
  "shift+right": (keys) => step(keys, SHIFT_FRAMES),
  home: (keys) => keys.clock.restart(),
  f: (keys) => keys.fit(),
  bracketleft: (keys) => keys.setSpeed(speedDetent(keys.speed, -1)),
  bracketright: (keys) => keys.setSpeed(speedDetent(keys.speed, 1)),
};

/** Pause, and move the clip by whole frames. */
function step(keys: SkinKeys, frames: number): void {
  keys.setPlaying(false);
  keys.clock.seek(keys.clock.time + frames * FRAME);
}

/**
 * The preview's keys, live wherever focus stands inside the box the ref is on.
 *
 * The particle shell's own set less the timeline's: a skin has no lanes, so nothing to
 * mute or solo. The box takes focus itself, so a click on bare preview is enough to arm
 * them.
 */
export function useSkinKeys(keys: SkinKeys): RefObject<HTMLDivElement | null> {
  return useHotkeys<HTMLDivElement>(
    Object.keys(KEYS).join(", "),
    (_, handler) => KEYS[handler.hotkey]?.(keys),
    { preventDefault: true },
    [keys],
  );
}
