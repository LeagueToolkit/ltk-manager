import type { EmitterModel } from "../../bin/vfx/engine/model/model";
import type { Driver } from "../../bin/vfx/engine/simulation/driver";
import { age01 } from "../../bin/vfx/engine/simulation/particleRead";
import type { DrawnEmitter } from "../../bin/vfx/rendering/utils/definitions";
import { drawsTheAttachment, isUndrawn } from "../../bin/vfx/rendering/utils/drawKind";

/** Whether a preview with no character draws `emitter`'s particles. */
export function drawsInPreview(emitter: EmitterModel): boolean {
  return !emitter.disabled && !isUndrawn(emitter) && !drawsTheAttachment(emitter);
}

/**
 * A reader of how far the burst a preview draws has come.
 *
 * It answers the life fraction of the oldest particle alive among `drawn`'s emitters, and
 * null while none is alive. A particle of an emitter that draws nothing, such as one that
 * only spawns children, does not count.
 */
export function createBurstReader(
  drawn: readonly DrawnEmitter[],
  draws: (emitter: EmitterModel) => boolean = drawsInPreview,
): (driver: Pick<Driver, "pool" | "time" | "sources">) => number | null {
  const byPath = new Map<string, boolean[]>();
  for (const { path, emitter } of drawn) {
    let flags = byPath.get(path);
    if (flags === undefined) {
      flags = [];
      byPath.set(path, flags);
    }
    flags[emitter.index] = draws(emitter);
  }

  return (driver) => {
    let oldest: number | null = null;

    for (const [path, flags] of byPath) {
      const sources = path === "" ? [driver] : driver.sources(path);
      for (const { pool, time } of sources) {
        for (let at = 0; at < pool.count; at += 1) {
          if (flags[pool.emitter[at]] !== true) continue;

          const age = age01(pool, at, time);
          if (oldest === null || age > oldest) oldest = age;
        }
      }
    }

    return oldest;
  };
}
