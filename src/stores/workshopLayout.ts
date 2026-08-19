import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which edge of the content browser the layers explorer docks to. */
type LayerPanelSide = "left" | "right";
type WadSort = "name" | "size";

interface WorkshopLayoutStore {
  layerPanelSide: LayerPanelSide;
  layerPanelOpen: boolean;
  /** Open state per explorer section, keyed by section id. Absent means default. */
  openSections: Record<string, boolean>;
  /** Body height per explorer section, in px, once a boundary has been dragged. */
  sectionHeights: Record<string, number>;
  /** Sidebar and surface shares of the browser, keyed by panel id. Null until the sash moves. */
  browserSplit: Record<string, number> | null;
  showLayerStats: boolean;
  wadSort: WadSort;
  setLayerPanelSide: (layerPanelSide: LayerPanelSide) => void;
  setLayerPanelOpen: (layerPanelOpen: boolean) => void;
  toggleSection: (id: string, open: boolean) => void;
  setSectionHeight: (id: string, height: number) => void;
  setBrowserSplit: (browserSplit: Record<string, number>) => void;
  setShowLayerStats: (showLayerStats: boolean) => void;
  setWadSort: (wadSort: WadSort) => void;
}

export const useWorkshopLayoutStore = create<WorkshopLayoutStore>()(
  persist(
    (set) => ({
      layerPanelSide: "left",
      layerPanelOpen: true,
      openSections: {},
      sectionHeights: {},
      browserSplit: null,
      showLayerStats: true,
      wadSort: "name",
      setLayerPanelSide: (layerPanelSide) => set({ layerPanelSide }),
      setLayerPanelOpen: (layerPanelOpen) => set({ layerPanelOpen }),
      toggleSection: (id, open) =>
        set((state) => ({ openSections: { ...state.openSections, [id]: open } })),
      setSectionHeight: (id, height) =>
        set((state) => ({ sectionHeights: { ...state.sectionHeights, [id]: height } })),
      setBrowserSplit: (browserSplit) => set({ browserSplit }),
      setShowLayerStats: (showLayerStats) => set({ showLayerStats }),
      setWadSort: (wadSort) => set({ wadSort }),
    }),
    { name: "ltk-workshop-layout", version: 1 },
  ),
);

export type { LayerPanelSide, WadSort };
export const useLayerPanelSide = () => useWorkshopLayoutStore((s) => s.layerPanelSide);
export const useSetLayerPanelSide = () => useWorkshopLayoutStore((s) => s.setLayerPanelSide);
export const useLayerPanelOpen = () => useWorkshopLayoutStore((s) => s.layerPanelOpen);
export const useSetLayerPanelOpen = () => useWorkshopLayoutStore((s) => s.setLayerPanelOpen);
export const useOpenSections = () => useWorkshopLayoutStore((s) => s.openSections);
export const useToggleSection = () => useWorkshopLayoutStore((s) => s.toggleSection);
export const useSectionHeights = () => useWorkshopLayoutStore((s) => s.sectionHeights);
export const useSetSectionHeight = () => useWorkshopLayoutStore((s) => s.setSectionHeight);
export const useBrowserSplit = () => useWorkshopLayoutStore((s) => s.browserSplit);
export const useSetBrowserSplit = () => useWorkshopLayoutStore((s) => s.setBrowserSplit);
export const useShowLayerStats = () => useWorkshopLayoutStore((s) => s.showLayerStats);
export const useSetShowLayerStats = () => useWorkshopLayoutStore((s) => s.setShowLayerStats);
export const useWadSort = () => useWorkshopLayoutStore((s) => s.wadSort);
export const useSetWadSort = () => useWorkshopLayoutStore((s) => s.setWadSort);
