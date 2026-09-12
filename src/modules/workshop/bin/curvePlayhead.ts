import { use } from "react";

import type { BinRow } from "@/lib/tauri";

import { useEmitters } from "./emitterChoice";
import { drawnAtBirth } from "./randomDraw";
import { emitterPhase } from "./vfx/particleRead";
import { useClockOf, VfxRunContext } from "./vfx/run";

/**
 * Where the run stands in `row`'s curve, or null where no playhead reaches it.
 *
 * A birth field samples its curve at its emitter's life, so the run's clock places it. A
 * per-particle field runs on every particle's own life at once and has no one place. A
 * child lane's emitter is not in the opened system's model, so it has none either.
 */
export function useCurvePlayhead(row: BinRow): number | null {
  const run = use(VfxRunContext);
  const { card, child } = useEmitters();
  const owned =
    card !== undefined &&
    child === null &&
    drawnAtBirth(row.name) &&
    row.path.startsWith(`${card.row.path}.`);
  const emitter = owned
    ? run?.system?.emitters.find(
        (each) => each.simple === card.simple && each.listIndex === card.index,
      )
    : undefined;
  const clock = useClockOf(emitter === undefined ? null : run);
  if (emitter === undefined || clock === null) return null;
  return emitterPhase(emitter, clock);
}
