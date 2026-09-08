import { create } from "zustand";

import type { SessionChanged, SessionGameRunning, SessionStarted } from "@/lib/tauri";

/**
 * Where a composed "Play" has got to.
 *
 * The last two are the Riot Client's news rather than ours: `launching` ends
 * when the client accepts the request, which is seconds before the game exists,
 * and the session is what carries the run from there to the end of the game.
 */
export type PlayStep =
  | "idle"
  | "starting-patcher"
  | "launching"
  | "cancelling"
  | "waiting-for-game"
  | "in-game";

/** The League session the backend is following. */
export interface LeagueSession {
  /**
   * The Riot Client's own phase spelling, e.g. `Pending` or `Gameplay`.
   *
   * What the *match* is doing. It is not the test for whether League is up:
   * a player sitting in the client reports `None`.
   */
  phase: string;
  /** Whether League itself is up, which is when mods reach a game. */
  running: boolean;
  /**
   * The content release the client reports for this session - a release id
   * rather than the patch number a player would recognise.
   */
  version: string | null;
}

interface PlaySessionStore {
  step: PlayStep;
  setStep: (step: PlayStep) => void;
  /** The live session, or null when no game is being followed. */
  session: LeagueSession | null;
  sessionStarted: (payload: SessionStarted) => void;
  /** The match moved on. Says nothing about whether League is up. */
  sessionChanged: (payload: SessionChanged) => void;
  /** League appeared, or went away, while the session stayed open. */
  sessionGameRunning: (payload: SessionGameRunning) => void;
  /**
   * The session is over.
   *
   * Takes nothing, because how it ended is news for a toast rather than state
   * to hold - and a bar still reporting the last game's exit code while the
   * next one starts would be the alternative.
   */
  sessionEnded: () => void;
  /**
   * The Riot Client took the launch request.
   *
   * `hasSession` is false when the outcome named no session id, which leaves
   * nothing to follow and so nothing that would ever end the run.
   */
  launchDelivered: (hasSession: boolean) => void;
}

/** The step a session in this state puts the run at. */
function stepFor(running: boolean): PlayStep {
  return running ? "in-game" : "waiting-for-game";
}

/**
 * The current Play run and the League session it produced, shared rather than
 * local.
 *
 * The session half is driven by backend events, so it is populated for a game
 * this app never launched too - one it adopted, or one that outlived a restart.
 */
export const usePlaySessionStore = create<PlaySessionStore>()((set) => ({
  step: "idle",
  setStep: (step) => set({ step }),
  session: null,

  sessionStarted: ({ phase, running, version }) =>
    set({
      session: { phase, running, version: version || null },
      step: stepFor(running),
    }),

  // The phase and the step are separate axes now: a match starting and ending
  // must not move a run that is already at "in game".
  sessionChanged: ({ phase }) =>
    set((state) => ({
      session: state.session && { ...state.session, phase },
    })),

  sessionGameRunning: ({ running }) =>
    set((state) => ({
      session: state.session && { ...state.session, running },
      step: stepFor(running),
    })),

  // The end of the session is the end of the run, whether or not this app
  // started it.
  sessionEnded: () => set({ session: null, step: "idle" }),

  launchDelivered: (hasSession) =>
    set((state) => {
      // The watcher polls immediately, so a session can open before the launch
      // command's reply gets back here. Already following one wins - stepping
      // back to `waiting-for-game` from `in-game` would be a regression.
      if (state.session !== null) return state;
      return { step: hasSession ? "waiting-for-game" : "idle" };
    }),
}));
