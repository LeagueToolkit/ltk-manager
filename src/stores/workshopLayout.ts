import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which edge of the content browser the layers explorer docks to. */
type LayerPanelSide = "left" | "right";
type WadSort = "name" | "size";
/**
 * What opening a file from a tree does to the strip.
 *
 * `append` gives every file its own tab, so a comparison across four textures
 * is four tabs. `replace` keeps one ephemeral tab and reuses it, which suits
 * reading through a directory one file at a time.
 */
type TabOpenMode = "append" | "replace";
/** How a preview scales its asset. `fit` sizes it to the pane, a number multiplies its pixels. */
type PreviewZoom = "fit" | number;

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
  tabOpenMode: TabOpenMode;
  /**
   * How every preview draws its asset, rather than each tab holding its own.
   *
   * A modder comparing four textures sets the zoom and the alpha checkerboard
   * once and reads all four the same way, which is the whole point of opening
   * them side by side.
   */
  previewZoom: PreviewZoom;
  previewCheckered: boolean;
  setLayerPanelSide: (layerPanelSide: LayerPanelSide) => void;
  setLayerPanelOpen: (layerPanelOpen: boolean) => void;
  toggleSection: (id: string, open: boolean) => void;
  setSectionHeight: (id: string, height: number) => void;
  setBrowserSplit: (browserSplit: Record<string, number>) => void;
  setShowLayerStats: (showLayerStats: boolean) => void;
  setWadSort: (wadSort: WadSort) => void;
  setTabOpenMode: (tabOpenMode: TabOpenMode) => void;
  setPreviewZoom: (previewZoom: PreviewZoom) => void;
  setPreviewCheckered: (previewCheckered: boolean) => void;
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
      tabOpenMode: "append",
      previewZoom: "fit",
      previewCheckered: true,
      setLayerPanelSide: (layerPanelSide) => set({ layerPanelSide }),
      setLayerPanelOpen: (layerPanelOpen) => set({ layerPanelOpen }),
      toggleSection: (id, open) =>
        set((state) => ({ openSections: { ...state.openSections, [id]: open } })),
      setSectionHeight: (id, height) =>
        set((state) => ({ sectionHeights: { ...state.sectionHeights, [id]: height } })),
      setBrowserSplit: (browserSplit) => set({ browserSplit }),
      setShowLayerStats: (showLayerStats) => set({ showLayerStats }),
      setWadSort: (wadSort) => set({ wadSort }),
      setTabOpenMode: (tabOpenMode) => set({ tabOpenMode }),
      setPreviewZoom: (previewZoom) => set({ previewZoom }),
      setPreviewCheckered: (previewCheckered) => set({ previewCheckered }),
    }),
    { name: "ltk-workshop-layout", version: 1 },
  ),
);

export type { LayerPanelSide, PreviewZoom, TabOpenMode, WadSort };
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
export const useTabOpenMode = () => useWorkshopLayoutStore((s) => s.tabOpenMode);
export const useSetTabOpenMode = () => useWorkshopLayoutStore((s) => s.setTabOpenMode);
export const usePreviewZoom = () => useWorkshopLayoutStore((s) => s.previewZoom);
export const useSetPreviewZoom = () => useWorkshopLayoutStore((s) => s.setPreviewZoom);
export const usePreviewCheckered = () => useWorkshopLayoutStore((s) => s.previewCheckered);
export const useSetPreviewCheckered = () => useWorkshopLayoutStore((s) => s.setPreviewCheckered);
