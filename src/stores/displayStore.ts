import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type ZoomLevel = 70 | 80 | 90 | 100 | 110 | 120 | 130;
type ReduceMotion = "system" | "on" | "off";

interface UiPreferences {
  showDiscordButton: boolean;
  showBugReportButton: boolean;
  showStorageButton: boolean;
  showNotificationBell: boolean;
  showDiagnosticsLink: boolean;
  showSortDropdown: boolean;
  showFilterPopover: boolean;
  showViewToggle: boolean;
}

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  showDiscordButton: true,
  showBugReportButton: true,
  showStorageButton: true,
  showNotificationBell: true,
  showDiagnosticsLink: true,
  showSortDropdown: true,
  showFilterPopover: true,
  showViewToggle: true,
};

interface DisplayStore {
  zoomLevel: ZoomLevel;
  reduceMotion: ReduceMotion;
  uiPreferences: UiPreferences;
  setZoomLevel: (zoomLevel: ZoomLevel) => void;
  setReduceMotion: (reduceMotion: ReduceMotion) => void;
  setUiPreference: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
}

const VALID_ZOOM_LEVELS: readonly ZoomLevel[] = [70, 80, 90, 100, 110, 120, 130];

const DENSITY_TO_ZOOM: Record<string, ZoomLevel> = {
  compact: 70,
  normal: 80,
  spacious: 100,
};

const _tauriStore = new LazyStore("ltk-display-prefs.json", { defaults: {} });

const tauriStorage = createJSONStorage(() => ({
  getItem: async (name: string) => {
    const value = await _tauriStore.get<string>(name);
    return value ?? null;
  },
  setItem: async (name: string, value: string) => {
    await _tauriStore.set(name, value);
  },
  removeItem: async (name: string) => {
    await _tauriStore.delete(name);
  },
}));

export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      zoomLevel: 100,
      reduceMotion: "system",
      uiPreferences: DEFAULT_UI_PREFERENCES,
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setUiPreference: (key, value) =>
        set((s) => ({ uiPreferences: { ...s.uiPreferences, [key]: value } })),
    }),
    {
      name: "ltk-display-prefs",
      storage: tauriStorage,
      partialize: (state) => ({
        zoomLevel: state.zoomLevel,
        reduceMotion: state.reduceMotion,
        uiPreferences: state.uiPreferences,
      }),
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          const oldDensity = state.density as string | undefined;
          const zoomLevel = oldDensity ? (DENSITY_TO_ZOOM[oldDensity] ?? 100) : 100;
          const { density: _, ...rest } = state;
          return { ...rest, zoomLevel } as DisplayStore;
        }
        if (version === 1) {
          return {
            ...state,
            uiPreferences: (state.uiPreferences as UiPreferences) ?? DEFAULT_UI_PREFERENCES,
          } as DisplayStore;
        }
        return persisted as DisplayStore;
      },
    },
  ),
);

export { VALID_ZOOM_LEVELS };
export type { UiPreferences, ZoomLevel };
export const useZoomLevel = () => useDisplayStore((s) => s.zoomLevel);
export const useSetZoomLevel = () => useDisplayStore((s) => s.setZoomLevel);
export const useReduceMotion = () => useDisplayStore((s) => s.reduceMotion);
export const useSetReduceMotion = () => useDisplayStore((s) => s.setReduceMotion);
export const useUiPreferences = () => useDisplayStore((s) => s.uiPreferences);
export const useSetUiPreference = () => useDisplayStore((s) => s.setUiPreference);
