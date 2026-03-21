import { create } from "zustand";
import { persist } from "zustand/middleware";

type Density = "compact" | "normal" | "spacious";
type ReduceMotion = "system" | "on" | "off";

interface DisplayStore {
  density: Density;
  reduceMotion: ReduceMotion;
  setDensity: (density: Density) => void;
  setReduceMotion: (reduceMotion: ReduceMotion) => void;
}

export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      density: "normal",
      reduceMotion: "system",
      setDensity: (density) => set({ density }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: "ltk-display-prefs",
    },
  ),
);
