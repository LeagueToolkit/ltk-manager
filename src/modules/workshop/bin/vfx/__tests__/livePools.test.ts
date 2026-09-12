import { describe, expect, it } from "vitest";

import { identityInto } from "../basis";
import type { DrawnEmitter } from "../definitions";
import type { Driver } from "../driver";
import { liveParticles, livePools } from "../livePools";
import type { EmitterModel } from "../model";
import type { Source } from "../particleRead";
import { createPool, type Pool, spawn } from "../pool";
import type { Point } from "../rig";
import { emitterOf } from "./emitterFixture";

const UNTURNED = identityInto(new Float32Array(9));

/** A pool holding one particle per place given, all of emitter zero. */
function poolOf(places: readonly Point[]): Pool {
  const pool = createPool(16);
  for (const place of places) {
    const at = spawn(pool, 0, 0, 100, 0);
    if (at === null) continue;
    pool.position.set(place, at * 3);
  }
  return pool;
}

function sourceOf(pool: Pool, origin: Point = [0, 0, 0]): Source {
  return { pool, time: 0, elapsed: 0, origin, target: origin, orientation: UNTURNED };
}

/** A driver standing on one pool, with the child feeds a test gives it. */
function driverOf(pool: Pool, feeds: Record<string, readonly Source[]> = {}): Driver {
  return {
    ...sourceOf(pool),
    sources: (path: string) => feeds[path] ?? [],
    liveChildren: () => Object.values(feeds).reduce((held, feed) => held + feed.length, 0),
  } as unknown as Driver;
}

function drawnOf(path: string, emitter: EmitterModel): DrawnEmitter {
  return { key: `${path}:${emitter.index}`, emitter, path, root: 0, rank: 0 };
}

describe("livePools", () => {
  it("reads the driver's own pool and every live child of a definition", () => {
    const own = emitterOf(0);
    const child = poolOf([[0, 0, 0]]);
    const driver = driverOf(poolOf([[0, 0, 0]]), { "0:0": [sourceOf(child)] });

    const pools = livePools(driver, [drawnOf("", own), drawnOf("0:0", emitterOf(0))]);

    expect(pools).toHaveLength(2);
    expect(liveParticles(pools)).toBe(2);
  });

  it("reads nothing for a definition no child is live for", () => {
    const driver = driverOf(poolOf([]));
    expect(livePools(driver, [drawnOf("0:0", emitterOf(0))])).toEqual([]);
  });
});
