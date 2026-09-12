/**
 * What the run has alive: the pools the draw reads and their tally.
 *
 * Stats counts that tally, "The viewer" in docs/ux/BIN_EDITOR.md.
 */

import type { DrawnEmitter } from "./definitions";
import type { Driver } from "./driver";
import type { EmitterModel } from "./model";
import type { Source } from "./particleRead";

/** One pool a read walks, and the emitters its own `emitter` column indexes. */
export interface LivePool {
  readonly source: Source;
  readonly emitters: readonly EmitterModel[];
}

/**
 * Every pool the run draws from: the driver's own, then each live child's.
 *
 * A child's pool is reached through the definition it belongs to, so a definition no
 * child is live for contributes none.
 */
export function livePools(driver: Driver, drawn: readonly DrawnEmitter[]): LivePool[] {
  const byPath = new Map<string, EmitterModel[]>();
  for (const definition of drawn) {
    let emitters = byPath.get(definition.path);
    if (emitters === undefined) {
      emitters = [];
      byPath.set(definition.path, emitters);
    }
    emitters[definition.emitter.index] = definition.emitter;
  }

  const pools: LivePool[] = [];
  for (const [path, emitters] of byPath) {
    const sources = path === "" ? [driver] : driver.sources(path);
    for (const source of sources) pools.push({ source, emitters });
  }
  return pools;
}

/** How many particles the run is simulating, a muted emitter's included. */
export function liveParticles(pools: readonly LivePool[]): number {
  let count = 0;
  for (const { source } of pools) count += source.pool.count;
  return count;
}
