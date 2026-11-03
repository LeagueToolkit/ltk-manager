import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { isChord } from "@/modules/keys";

import { useAtlasPreviewActions } from "../state/atlasPreview";

/** The handlers of the keys the canvas reads while they are held down. */
export interface HeldKeys {
  /** Hold the key `event` presses, and answer whether it was one the canvas holds. */
  readonly press: (event: ReactKeyboardEvent) => boolean;
  readonly lift: (event: ReactKeyboardEvent) => void;
  /** Let go of every held key, as the canvas does when it loses focus. */
  readonly release: () => void;
}

/**
 * The keys the canvas reads while held: Space, which turns a drag into a pan through
 * `holdSpace`, and Shift, which shows the tooltip Shift shows. Shift alone is a nudge and
 * arrange modifier while editing, so only playing the view, `interact`, holds it.
 */
export function useHeldKeys(holdSpace: (held: boolean) => void, interact: boolean): HeldKeys {
  const { setShiftHeld } = useAtlasPreviewActions();

  return {
    press: (event) => {
      if (event.key === "Shift") {
        if (interact) setShiftHeld(true);
        return true;
      }
      if (!isChord(event, "atlas.pan")) return false;

      holdSpace(true);
      event.preventDefault();
      return true;
    },
    lift: (event) => {
      if (event.key === " ") holdSpace(false);
      if (event.key === "Shift") setShiftHeld(false);
    },
    release: () => {
      holdSpace(false);
      setShiftHeld(false);
    },
  };
}
