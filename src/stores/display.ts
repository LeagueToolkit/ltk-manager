import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MonoFont, SansFont } from "@/lib/fonts";

/** Interface scale as a percent, on the `ZOOM_STEP` grid between `ZOOM_MIN` and `ZOOM_MAX`. */
type ZoomLevel = number;
type ReduceMotion = "system" | "on" | "off";
type CornerStyle = "sharp" | "default" | "round";
type CardScale = 70 | 80 | 90 | 100 | 110 | 120 | 130;
type ScrollMode = "smooth" | "spring";
type ScrollbarSize = "thin" | "default" | "wide";

interface DisplayStore {
  zoomLevel: ZoomLevel;
  reduceMotion: ReduceMotion;
  scrollMode: ScrollMode;
  scrollbarSize: ScrollbarSize;
  cornerStyle: CornerStyle;
  sansFont: SansFont;
  monoFont: MonoFont;
  /** Percent of each surface rung's authored chroma, so 0 is a neutral grey ramp. */
  surfaceTint: number;
  cardScale: CardScale;
  setZoomLevel: (zoomLevel: ZoomLevel) => void;
  setReduceMotion: (reduceMotion: ReduceMotion) => void;
  setScrollMode: (scrollMode: ScrollMode) => void;
  setScrollbarSize: (scrollbarSize: ScrollbarSize) => void;
  setCornerStyle: (cornerStyle: CornerStyle) => void;
  setSansFont: (sansFont: SansFont) => void;
  setMonoFont: (monoFont: MonoFont) => void;
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
  sansFont: "geist",
  monoFont: "geist",
  surfaceTint: 30,
  scrollMode: "smooth",
  scrollbarSize: "default",
} satisfies Pick<
  DisplayStore,
  | "zoomLevel"
  | "reduceMotion"
  | "cornerStyle"
  | "sansFont"
  | "monoFont"
  | "surfaceTint"
  | "scrollMode"
  | "scrollbarSize"
>;

type AppearanceKey = keyof typeof APPEARANCE_DEFAULTS;

const APPEARANCE_KEYS = Object.keys(APPEARANCE_DEFAULTS) as AppearanceKey[];

/* Symmetric about 100 so the default sits at the middle of the rail. */
const ZOOM_MIN = 50;
const ZOOM_MAX = 150;
/** The grid every level snaps to, and what the keyboard shortcuts move by. */
const ZOOM_STEP = 2;

/* Every level reaching the store passes through here, so nothing can store a
   zoom off the grid or past an end the slider cannot reach. */
function clampZoom(zoomLevel: number): ZoomLevel {
  const snapped = Math.round(zoomLevel / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

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
      setZoomLevel: (zoomLevel) => set({ zoomLevel: clampZoom(zoomLevel) }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setScrollMode: (scrollMode) => set({ scrollMode }),
      setScrollbarSize: (scrollbarSize) => set({ scrollbarSize }),
      setCornerStyle: (cornerStyle) => set({ cornerStyle }),
      setSansFont: (sansFont) => set({ sansFont }),
      setMonoFont: (monoFont) => set({ monoFont }),
      setSurfaceTint: (surfaceTint) => set({ surfaceTint }),
      setCardScale: (cardScale) => set({ cardScale }),
      resetAppearance: () => set(APPEARANCE_DEFAULTS),
    }),
    {
      name: "ltk-display-prefs",
      version: 8,
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
          return {
            ...state,
            surfaceTint: APPEARANCE_DEFAULTS.surfaceTint,
            sansFont: APPEARANCE_DEFAULTS.sansFont,
            monoFont: APPEARANCE_DEFAULTS.monoFont,
          } as DisplayStore;
        }
        if (version === 7) {
          return {
            ...state,
            sansFont: APPEARANCE_DEFAULTS.sansFont,
            monoFont: APPEARANCE_DEFAULTS.monoFont,
          } as DisplayStore;
        }
        return persisted as DisplayStore;
      },
    },
  ),
);

export { APPEARANCE_DEFAULTS, APPEARANCE_KEYS, VALID_CARD_SCALES, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP };
export type {
  AppearanceKey,
  CardScale,
  CornerStyle,
  MonoFont,
  SansFont,
  ScrollbarSize,
  ScrollMode,
  ZoomLevel,
};
export const useZoomLevel = () => useDisplayStore((s) => s.zoomLevel);
export const useSetZoomLevel = () => useDisplayStore((s) => s.setZoomLevel);
export const useSansFont = () => useDisplayStore((s) => s.sansFont);
export const useSetSansFont = () => useDisplayStore((s) => s.setSansFont);
export const useMonoFont = () => useDisplayStore((s) => s.monoFont);
export const useSetMonoFont = () => useDisplayStore((s) => s.setMonoFont);
export const useReduceMotion = () => useDisplayStore((s) => s.reduceMotion);
export const useSetReduceMotion = () => useDisplayStore((s) => s.setReduceMotion);
export const useScrollMode = () => useDisplayStore((s) => s.scrollMode);
export const useSetScrollMode = () => useDisplayStore((s) => s.setScrollMode);
export const useScrollbarSize = () => useDisplayStore((s) => s.scrollbarSize);
export const useSetScrollbarSize = () => useDisplayStore((s) => s.setScrollbarSize);
export const useCornerStyle = () => useDisplayStore((s) => s.cornerStyle);
export const useSetCornerStyle = () => useDisplayStore((s) => s.setCornerStyle);
export const useSurfaceTint = () => useDisplayStore((s) => s.surfaceTint);
export const useSetSurfaceTint = () => useDisplayStore((s) => s.setSurfaceTint);
export const useCardScale = () => useDisplayStore((s) => s.cardScale);
export const useSetCardScale = () => useDisplayStore((s) => s.setCardScale);
export const useResetAppearance = () => useDisplayStore((s) => s.resetAppearance);
