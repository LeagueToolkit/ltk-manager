/** The time a scene's animated parts are sampled at, which whoever owns the scene advances. */
export interface SceneClock {
  /** Seconds since the scene last started over. */
  readonly time: number;
  /** How many times the clock was set rather than advanced, which a follower replays on. */
  readonly generation: number;
  /** Spend `seconds` of a frame. */
  advance(seconds: number): void;
  /** Stand the clock at `time`, a jump every follower replays to rather than steps over. */
  seek(time: number): void;
  /** Start the scene over from zero. */
  restart(): void;
}

/** A clock standing at zero. */
export function createSceneClock(): SceneClock {
  let time = 0;
  let generation = 0;
  const seek = (to: number) => {
    time = Math.max(to, 0);
    generation += 1;
  };

  return {
    get time() {
      return time;
    },
    get generation() {
      return generation;
    },
    advance(seconds) {
      time += seconds;
    },
    seek,
    restart() {
      seek(0);
    },
  };
}
