import { type RefObject, useCallback, useEffect } from "react";
import { create } from "zustand";

import { useShowSidebarView } from "@/stores";

interface GameSearchRevealStore {
  /**
   * Bumped by every route into the game search.
   *
   * The box focuses when this moves past what it has answered, which is what
   * `Ctrl+Shift+F` has to do even while the search view is already showing.
   * A counter rather than a flag, so two reveals in a row both land.
   */
  reveal: number;
  /** The last reveal the box answered, so a plain tab switch steals no focus. */
  answered: number;
  bump: () => void;
  answer: (reveal: number) => void;
}

const useRevealStore = create<GameSearchRevealStore>()((set) => ({
  reveal: 0,
  answered: 0,
  bump: () => set((state) => ({ reveal: state.reveal + 1 })),
  answer: (reveal) => set({ answered: reveal }),
}));

/** Show the search view and focus its box. */
export function useRevealGameSearch(): () => void {
  const showView = useShowSidebarView();
  const bump = useRevealStore((state) => state.bump);

  return useCallback(() => {
    showView("search");
    bump();
  }, [showView, bump]);
}

/**
 * Focus and select `ref` on every reveal it has not answered yet.
 *
 * The box lives in the active document's toolbar portal, so it remounts on
 * every switch back to the tab. The answered mark is what tells the mount a
 * reveal caused apart from the mounts a tab switch causes.
 */
export function useGameSearchRevealTarget(ref: RefObject<HTMLInputElement | null>): void {
  const reveal = useRevealStore((state) => state.reveal);
  const answered = useRevealStore((state) => state.answered);
  const answer = useRevealStore((state) => state.answer);

  useEffect(() => {
    if (reveal === answered) return;
    answer(reveal);
    ref.current?.select();
  }, [reveal, answered, answer, ref]);
}
