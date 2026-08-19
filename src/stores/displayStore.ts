import { create } from "zustand";
import { persist } from "zustand/middleware";

type ZoomLevel = 70 | 80 | 90 | 100 | 110 | 120 | 130;
type ReduceMotion = "system" | "on" | "off";
type CornerStyle = "sharp" | "default" | "round";
type CardScale = 70 | 80 | 90 | 100 | 110 | 120 | 130;
type ScrollMode = "smooth" | "spring";

interface DisplayStore {
  zoomLevel: ZoomLevel;
  reduceMotion: ReduceMotion;
  scrollMode: ScrollMode;
  cornerStyle: CornerStyle;
  /** Percent of each surface rung's authored chroma, so 0 is a neutral grey ramp. */
  surfaceTint: number;
  cardScale: CardScale;
  setZoomLevel: (zoomLevel: ZoomLevel) => void;
  setReduceMotion: (reduceMotion: ReduceMotion) => void;
  setScrollMode: (scrollMode: ScrollMode) => void;
  setCornerStyle: (cornerStyle: CornerStyle) => void;
  setSurfaceTint: (surfaceTint: number) => void;
  setCardScale: (cardScale: CardScale) => void;
  resetAppearance: () => void;
}

/* What the Appearance panel owns. cardScale lives in this store too but is set from
   the library's view options, so a reset here would reach outside the panel. */
const APPEARANCE_DEFAULTS = {
  zoomLevel: 100,
  reduceMotion: "system",
  cornerStyle: "default",
  surfaceTint: 30,
  scrollMode: "smooth",
} satisfies Pick<
  DisplayStore,
  "zoomLevel" | "reduceMotion" | "cornerStyle" | "surfaceTint" | "scrollMode"
>;

const APPEARANCE_KEYS = Object.keys(APPEARANCE_DEFAULTS) as (keyof typeof APPEARANCE_DEFAULTS)[];

const VALID_ZOOM_LEVELS: readonly ZoomLevel[] = [70, 80, 90, 100, 110, 120, 130];

const VALID_CARD_SCALES: readonly CardScale[] = [70, 80, 90, 100, 110, 120, 130];

const DENSITY_TO_ZOOM: Record<string, ZoomLevel> = {
  compact: 70,
  normal: 80,
  spacious: 100,
};

export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      cardScale: 100,
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setScrollMode: (scrollMode) => set({ scrollMode }),
      setCornerStyle: (cornerStyle) => set({ cornerStyle }),
      setSurfaceTint: (surfaceTint) => set({ surfaceTint }),
      setCardScale: (cardScale) => set({ cardScale }),
      resetAppearance: () => set(APPEARANCE_DEFAULTS),
    }),
    {
      name: "ltk-display-prefs",
      version: 7,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          const oldDensity = state.density as string | undefined;
          const zoomLevel = oldDensity ? (DENSITY_TO_ZOOM[oldDensity] ?? 100) : 100;
          const { density: _, ...rest } = state;
          return {
            ...rest,
            zoomLevel,
            cornerStyle: "default",
            cardScale: 100,
            scrollMode: APPEARANCE_DEFAULTS.scrollMode,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
          } as DisplayStore;
        }
        if (version === 1) {
          return {
            ...state,
            cornerStyle: "default",
            cardScale: 100,
            scrollMode: APPEARANCE_DEFAULTS.scrollMode,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
          } as DisplayStore;
        }
        if (version === 2) {
          return {
            ...state,
            cardScale: 100,
            scrollMode: APPEARANCE_DEFAULTS.scrollMode,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
          } as DisplayStore;
        }
        if (version === 3) {
          return {
            ...state,
            scrollMode: APPEARANCE_DEFAULTS.scrollMode,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
          } as DisplayStore;
        }
        if (version === 4) {
          const scrollMode = state.scrollMode === "spring" ? "spring" : "smooth";
          return {
            ...state,
            scrollMode,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
          } as DisplayStore;
        }
        if (version === 5) {
          return { ...state, surfaceTint: APPEARANCE_DEFAULTS.surfaceTint } as DisplayStore;
        }
        // 6 never shipped, so nobody chose the tint it stored on their behalf.
        if (version === 6) {
          return { ...state, surfaceTint: APPEARANCE_DEFAULTS.surfaceTint } as DisplayStore;
        }
        return persisted as DisplayStore;
      },
    },
  ),
);

export { VALID_CARD_SCALES, VALID_ZOOM_LEVELS };
export type { CardScale, CornerStyle, ScrollMode, ZoomLevel };
export const useZoomLevel = () => useDisplayStore((s) => s.zoomLevel);
export const useSetZoomLevel = () => useDisplayStore((s) => s.setZoomLevel);
export const useReduceMotion = () => useDisplayStore((s) => s.reduceMotion);
export const useSetReduceMotion = () => useDisplayStore((s) => s.setReduceMotion);
export const useScrollMode = () => useDisplayStore((s) => s.scrollMode);
export const useSetScrollMode = () => useDisplayStore((s) => s.setScrollMode);
export const useCornerStyle = () => useDisplayStore((s) => s.cornerStyle);
export const useSetCornerStyle = () => useDisplayStore((s) => s.setCornerStyle);
export const useSurfaceTint = () => useDisplayStore((s) => s.surfaceTint);
export const useSetSurfaceTint = () => useDisplayStore((s) => s.setSurfaceTint);
export const useCardScale = () => useDisplayStore((s) => s.cardScale);
export const useSetCardScale = () => useDisplayStore((s) => s.setCardScale);
export const useResetAppearance = () => useDisplayStore((s) => s.resetAppearance);
export const useIsAppearanceDefault = () =>
  useDisplayStore((s) => APPEARANCE_KEYS.every((key) => s[key] === APPEARANCE_DEFAULTS[key]));
