import { createContext, use } from "react";

import type { LightGrid } from "../../assets/parsing/lightGridBuffer";
import { DEFAULT_SUN, type SunLight } from "../utils/sunLight";

/** What lights a character in the enclosing viewport. */
export interface CharacterLight {
  /** The map's baked ambient, and null where the map bakes none or none is drawn. */
  readonly grid: LightGrid | null;
  /** The sun the scene draws under, which builds the ambient where there is no grid. */
  readonly sun: SunLight;
}

export const CharacterLightContext = createContext<CharacterLight>({
  grid: null,
  sun: DEFAULT_SUN,
});

/** The light of the viewport the caller sits in. */
export function useCharacterLight(): CharacterLight {
  return use(CharacterLightContext);
}
