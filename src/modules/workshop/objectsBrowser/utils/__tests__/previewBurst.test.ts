import { expect, it } from "vitest";

import type { EmitterModel } from "../../../bin/vfx/engine/model/model";
import type { Pool } from "../../../bin/vfx/engine/simulation/pool";
import type { DrawnEmitter } from "../../../bin/vfx/rendering/utils/definitions";
import { createBurstReader } from "../previewBurst";

/** A pool of particles, each an emitter index, a birth time and a lifetime. */
function pool(particles: readonly (readonly [number, number, number])[]): Pool {
  return {
    count: particles.length,
    emitter: Int32Array.from(particles.map(([emitter]) => emitter)),
    birthTime: Float32Array.from(particles.map(([, born]) => born)),
    lifetime: Float32Array.from(particles.map(([, , life]) => life)),
  } as unknown as Pool;
}

function definition(index: number, path = ""): DrawnEmitter {
  return {
    key: `${path}:${index}`,
    emitter: { index } as EmitterModel,
    path,
    root: index,
    rank: index,
  };
}

/** Emitter 1 of each system only spawns children and draws nothing. */
const draws = (emitter: EmitterModel) => emitter.index !== 1;

it("reads nothing while only an emitter that draws nothing has particles", () => {
  const read = createBurstReader([definition(0), definition(1)], draws);
  const driver = { pool: pool([[1, 0, 1]]), time: 0.5, sources: () => [] };

  expect(read(driver)).toBeNull();
});

it("answers the life fraction of the oldest drawn particle", () => {
  const read = createBurstReader([definition(0), definition(1)], draws);
  const driver = {
    pool: pool([
      [0, 0.4, 1],
      [1, 0, 1],
      [0, 0, 2],
    ]),
    time: 0.6,
    sources: () => [],
  };

  expect(read(driver)).toBeCloseTo(0.3);
});

it("reads the pools of the live children a drawn definition belongs to", () => {
  const child = { pool: pool([[0, 0, 1]]), time: 0.25 };
  const read = createBurstReader([definition(1), definition(0, "0.0")], draws);
  const driver = {
    pool: pool([[1, 0, 1]]),
    time: 0.25,
    sources: (path: string) => (path === "0.0" ? [child] : []),
  };

  expect(read(driver as never)).toBeCloseTo(0.25);
});
