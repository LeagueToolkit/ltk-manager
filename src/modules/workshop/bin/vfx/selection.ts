import type { EmitterModel, SystemModel } from "./model";

/** How the strip and the lanes name an emitter: its place in its own list, and which list. */
export interface EmitterPlace {
  readonly index: number;
  readonly simple: boolean;
}

/**
 * The emitter a card or a lane has open, as an index into the pool.
 *
 * A card is keyed on its place in its own list, so the join is that place plus which of
 * the two lists it came out of.
 */
export function chosenEmitter(
  system: SystemModel | null,
  place: EmitterPlace | undefined,
): number | null {
  if (system === null || place === undefined) return null;
  const held = system.emitters.find(
    (emitter: EmitterModel) => emitter.simple === place.simple && emitter.listIndex === place.index,
  );
  return held?.index ?? null;
}
