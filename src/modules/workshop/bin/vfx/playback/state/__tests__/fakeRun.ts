import { vi } from "vitest";

import { OPENING_RIG } from "../../../engine/model/rig";
import { createDriver } from "../../../engine/simulation/driver";
import type { VfxRun } from "../run";

/** A paused run at zero over no system, every action a spy, and a `tick` that sounds its clock. */
export function fakeRun(over: Partial<VfxRun> = {}): { run: VfxRun; tick: () => void } {
  const listeners = new Set<() => void>();
  const run: VfxRun = {
    document: 1,
    system: null,
    error: null,
    pending: false,
    driver: createDriver(1),
    playing: false,
    warming: false,
    speed: 1,
    seed: 1,
    rig: OPENING_RIG,
    looping: true,
    muted: new Set(),
    soloed: new Set(),
    loop: null,
    pinned: null,
    span: 2,
    resumed: false,
    fitRequest: 0,
    requestFit: vi.fn(),
    setPlaying: vi.fn(),
    setWarming: vi.fn(),
    setSpeed: vi.fn(),
    setRig: vi.fn(),
    setLooping: vi.fn(),
    reroll: vi.fn(),
    toggleMuted: vi.fn(),
    toggleSoloed: vi.fn(),
    setMuted: vi.fn(),
    setSoloed: vi.fn(),
    setLoop: vi.fn(),
    setPinned: vi.fn(),
    seek: vi.fn(),
    step: vi.fn(),
    seekEnd: vi.fn(),
    restart: vi.fn(),
    beginScrub: vi.fn(),
    endScrub: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...over,
  };

  return {
    run,
    tick: () => {
      for (const listener of listeners) listener();
    },
  };
}
