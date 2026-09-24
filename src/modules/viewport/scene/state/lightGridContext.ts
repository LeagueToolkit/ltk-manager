import { createContext, use } from "react";

import type { LightGrid } from "../../assets/parsing/lightGridBuffer";

/** The baked ambient of the map the enclosing viewport draws, and null without one. */
export const LightGridContext = createContext<LightGrid | null>(null);

/** The light grid of the viewport the caller sits in. */
export function useLightGrid(): LightGrid | null {
  return use(LightGridContext);
}
