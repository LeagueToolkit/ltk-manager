import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CameraPreset } from "@/modules/viewport";

import { keepUnversioned } from "./storage";

/** Which edge of the content browser the primary side panel docks to. */
type LayerPanelSide = "left" | "right";
type WadSort = "name" | "size";

/** Which view the rail has the primary side panel showing, ADR-0038. */
type SidebarViewId = "explorer" | "search" | "problems" | "objects" | "game" | "source";

/** How a preview draws the run: shaded, as its triangle edges alone, or edges over shading. */
type PreviewWireframe = "off" | "only" | "overlay";

/**
 * What a viewport draws around the run, and how the inspector lists a class.
 *
 * Display preferences, app-wide and persisted beside `previewCheckered` (ADR-0037). The
 * run itself - the seed, the rig, the playhead - is kept per system for the session.
 */
interface PreviewDisplay {
  /** The ground and its grid are drawn. */
  previewGround: boolean;
  /** The ground wears the midlane's texture. */
  previewMidlane: boolean;
  /** The selected emitter's origin, offset and spawn shape are drawn as a wireframe. */
  previewGizmo: boolean;
  /** The live counts and the frame's milliseconds are drawn in the corner. */
  previewStats: boolean;
  /** The camera a viewport opens on, "The viewer" in docs/ux/BIN_EDITOR.md. */
  previewCamera: CameraPreset;
  previewWireframe: PreviewWireframe;
  /** The timeline's lanes draw each emitter's live particles per step over its bar. */
  timelineHistogram: boolean;
  /** The inspector lists every field the class declares, the unauthored ones dimmed. */
  inspectorDefaults: boolean;
}
/**
 * What opening a file from a tree does to the strip.
 *
 * `append` gives every file its own tab, so a comparison across four textures
 * is four tabs. `replace` keeps one ephemeral tab and reuses it, which suits
 * reading through a directory one file at a time.
 */
type TabOpenMode = "append" | "replace";

/** Which drawing of an explorer's rows is on screen. */
type ExplorerView = "tree" | "grid" | "details";

/** The widths a tile draws at, which are the widths a thumbnail is asked for. */
const EXPLORER_TILE_SIZES = [64, 96, 128, 160, 192, 256] as const;
type ExplorerTileSize = (typeof EXPLORER_TILE_SIZES)[number];

/**
 * The heights a details row draws at, which its art is measured against.
 *
 * Its own setting rather than the tile size, because the two answer different
 * questions: how big the art is, and how many rows fit. The tallest still
 * leaves the art under 64px, so every row asks the asset scheme for that one
 * width whatever this is.
 */
const EXPLORER_ROW_HEIGHTS = [20, 24, 28, 36, 48, 64] as const;
type ExplorerRowHeight = (typeof EXPLORER_ROW_HEIGHTS)[number];

/**
 * The fixed columns of the details list, in px, which its dividers drag.
 *
 * Mirrored from `explorer/columns.ts` rather than imported, because a store
 * that reached into a module would close a cycle back onto itself.
 */
interface ExplorerColumns {
  size: number;
  kind: number;
}

type ExplorerSortField = "name" | "size" | "kind";
type ExplorerSortDirection = "asc" | "desc";

interface ExplorerSort {
  field: ExplorerSortField;
  direction: ExplorerSortDirection;
}

interface WorkshopLayoutStore extends PreviewDisplay {
  layerPanelSide: LayerPanelSide;
  layerPanelOpen: boolean;
  /** The view the rail last selected, which reopening the panel returns to. */
  sidebarView: SidebarViewId;
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
   * Whether every preview draws its asset on the alpha checkerboard.
   *
   * A display preference and not a viewport, so a modder sets it once and every
   * preview reads it. The zoom and the pan live in one preview instead. A file
   * opened after a 3200% read wants its own whole image first.
   */
  previewCheckered: boolean;
  /**
   * Whether the project bar searches the installed game.
   *
   * The one search source with a cost: the first query of a session builds an
   * index over every archive. A modder who never copies a game file pays
   * nothing for it, and a modder who does gets the whole install in the same
   * box as their own project.
   */
  searchGame: boolean;
  /**
   * Whether the project bar searches the bin objects the install declares.
   *
   * Off by default, because the index behind it reads every bin of the install
   * once a session. The switch is the consent: turning it on builds the index
   * at once, and turning it off drops it.
   */
  searchObjects: boolean;
  /**
   * Whether Problems draws the lints for Meta changes Riot has not deployed.
   *
   * On, because the day a change lands is the day every mod that shipped the
   * old shape stops working, and a modder who first hears about it that morning
   * is a modder who ships broken. A mod is not wrong about a schema the running
   * game has not taken, so the panel dims them rather than counting them, and
   * the switch above the list takes them off it.
   */
  forwardLookingMeta: boolean;
  /**
   * How every explorer draws, and what its tiles look like.
   *
   * A work habit rather than a place, so it belongs to the application and not
   * to a document: a modder who reads by size reads every explorer by size, and
   * one on a laptop turns the thumbnails off once. Where an explorer is stands
   * apart, in the session store beside the expansion it already keeps.
   */
  explorerView: ExplorerView;
  explorerTileSize: ExplorerTileSize;
  explorerRowHeight: ExplorerRowHeight;
  explorerThumbnails: boolean;
  explorerSort: ExplorerSort;
  explorerColumns: ExplorerColumns;
  setExplorerView: (explorerView: ExplorerView) => void;
  setExplorerTileSize: (explorerTileSize: ExplorerTileSize) => void;
  setExplorerRowHeight: (explorerRowHeight: ExplorerRowHeight) => void;
  setExplorerThumbnails: (explorerThumbnails: boolean) => void;
  setExplorerSort: (explorerSort: ExplorerSort) => void;
  setExplorerColumn: (column: keyof ExplorerColumns, width: number) => void;
  setLayerPanelSide: (layerPanelSide: LayerPanelSide) => void;
  setLayerPanelOpen: (layerPanelOpen: boolean) => void;
  /** Show `sidebarView` in the primary side panel, opening the panel if it is hidden. */
  showSidebarView: (sidebarView: SidebarViewId) => void;
  toggleSection: (id: string, open: boolean) => void;
  setSectionHeight: (id: string, height: number) => void;
  setBrowserSplit: (browserSplit: Record<string, number>) => void;
  setShowLayerStats: (showLayerStats: boolean) => void;
  setWadSort: (wadSort: WadSort) => void;
  setTabOpenMode: (tabOpenMode: TabOpenMode) => void;
  setPreviewCheckered: (previewCheckered: boolean) => void;
  setSearchGame: (searchGame: boolean) => void;
  setSearchObjects: (searchObjects: boolean) => void;
  setForwardLookingMeta: (forwardLookingMeta: boolean) => void;
  setPreviewDisplay: (display: Partial<PreviewDisplay>) => void;
}

const PREVIEW_DISPLAY_DEFAULTS: PreviewDisplay = {
  previewGround: true,
  previewMidlane: true,
  previewGizmo: true,
  previewStats: false,
  previewCamera: "game",
  previewWireframe: "off",
  timelineHistogram: false,
  inspectorDefaults: false,
};

/* What the Project editor card shows. The rest of this store is geometry, which is
   remembered rather than chosen, so a settings key exists only for these four. */
const PROJECT_EDITOR_DEFAULTS = {
  tabOpenMode: "append",
  searchGame: true,
  searchObjects: false,
  forwardLookingMeta: true,
} satisfies Pick<
  WorkshopLayoutStore,
  "tabOpenMode" | "searchGame" | "searchObjects" | "forwardLookingMeta"
>;

type ProjectEditorKey = keyof typeof PROJECT_EDITOR_DEFAULTS;

export const useWorkshopLayoutStore = create<WorkshopLayoutStore>()(
  persist(
    (set) => ({
      layerPanelSide: "left",
      layerPanelOpen: true,
      sidebarView: "explorer",
      openSections: {},
      sectionHeights: {},
      browserSplit: null,
      showLayerStats: true,
      wadSort: "name",
      previewCheckered: true,
      explorerView: "tree",
      explorerTileSize: 128,
      explorerRowHeight: 24,
      explorerThumbnails: true,
      explorerSort: { field: "name", direction: "asc" },
      explorerColumns: { size: 88, kind: 112 },
      ...PROJECT_EDITOR_DEFAULTS,
      ...PREVIEW_DISPLAY_DEFAULTS,
      setExplorerView: (explorerView) => set({ explorerView }),
      setExplorerTileSize: (explorerTileSize) => set({ explorerTileSize }),
      setExplorerRowHeight: (explorerRowHeight) => set({ explorerRowHeight }),
      setExplorerThumbnails: (explorerThumbnails) => set({ explorerThumbnails }),
      setExplorerSort: (explorerSort) => set({ explorerSort }),
      /* One column rather than the record, so a drag's writer is stable across
         the re-renders the drag itself causes. */
      setExplorerColumn: (column, width) =>
        set((state) => ({ explorerColumns: { ...state.explorerColumns, [column]: width } })),
      setLayerPanelSide: (layerPanelSide) => set({ layerPanelSide }),
      setLayerPanelOpen: (layerPanelOpen) => set({ layerPanelOpen }),
      showSidebarView: (sidebarView) => set({ layerPanelOpen: true, sidebarView }),
      toggleSection: (id, open) =>
        set((state) => ({ openSections: { ...state.openSections, [id]: open } })),
      setSectionHeight: (id, height) =>
        set((state) => ({ sectionHeights: { ...state.sectionHeights, [id]: height } })),
      setBrowserSplit: (browserSplit) => set({ browserSplit }),
      setShowLayerStats: (showLayerStats) => set({ showLayerStats }),
      setWadSort: (wadSort) => set({ wadSort }),
      setTabOpenMode: (tabOpenMode) => set({ tabOpenMode }),
      setPreviewCheckered: (previewCheckered) => set({ previewCheckered }),
      setSearchGame: (searchGame) => set({ searchGame }),
      setSearchObjects: (searchObjects) => set({ searchObjects }),
      setForwardLookingMeta: (forwardLookingMeta) => set({ forwardLookingMeta }),
      setPreviewDisplay: (display) => set(display),
    }),
    {
      name: "ltk-workshop-layout",
      version: 1,
      migrate: keepUnversioned<WorkshopLayoutStore>,
    },
  ),
);

export {
  EXPLORER_ROW_HEIGHTS,
  EXPLORER_TILE_SIZES,
  PREVIEW_DISPLAY_DEFAULTS,
  PROJECT_EDITOR_DEFAULTS,
};
export type {
  ExplorerColumns,
  ExplorerRowHeight,
  ExplorerSort,
  ExplorerSortDirection,
  ExplorerSortField,
  ExplorerTileSize,
  ExplorerView,
  LayerPanelSide,
  PreviewDisplay,
  PreviewWireframe,
  ProjectEditorKey,
  SidebarViewId,
  TabOpenMode,
  WadSort,
};
export const useExplorerView = () => useWorkshopLayoutStore((s) => s.explorerView);
export const useSetExplorerView = () => useWorkshopLayoutStore((s) => s.setExplorerView);
export const useExplorerTileSize = () => useWorkshopLayoutStore((s) => s.explorerTileSize);
export const useExplorerRowHeight = () => useWorkshopLayoutStore((s) => s.explorerRowHeight);
export const useSetExplorerRowHeight = () => useWorkshopLayoutStore((s) => s.setExplorerRowHeight);
export const useSetExplorerTileSize = () => useWorkshopLayoutStore((s) => s.setExplorerTileSize);
export const useExplorerThumbnails = () => useWorkshopLayoutStore((s) => s.explorerThumbnails);
export const useSetExplorerThumbnails = () =>
  useWorkshopLayoutStore((s) => s.setExplorerThumbnails);
export const useExplorerSort = () => useWorkshopLayoutStore((s) => s.explorerSort);
export const useSetExplorerSort = () => useWorkshopLayoutStore((s) => s.setExplorerSort);
export const useExplorerColumns = () => useWorkshopLayoutStore((s) => s.explorerColumns);
export const useSetExplorerColumn = () => useWorkshopLayoutStore((s) => s.setExplorerColumn);
export const useLayerPanelSide = () => useWorkshopLayoutStore((s) => s.layerPanelSide);
export const useSetLayerPanelSide = () => useWorkshopLayoutStore((s) => s.setLayerPanelSide);
export const useLayerPanelOpen = () => useWorkshopLayoutStore((s) => s.layerPanelOpen);
export const useSetLayerPanelOpen = () => useWorkshopLayoutStore((s) => s.setLayerPanelOpen);
export const useSidebarView = () => useWorkshopLayoutStore((s) => s.sidebarView);
export const useShowSidebarView = () => useWorkshopLayoutStore((s) => s.showSidebarView);
export const useOpenSections = () => useWorkshopLayoutStore((s) => s.openSections);
/** Whether section `id` was left open or shut, and undefined where it never was either. */
export const useSectionOpen = (id: string) => useWorkshopLayoutStore((s) => s.openSections[id]);
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
export const usePreviewCheckered = () => useWorkshopLayoutStore((s) => s.previewCheckered);
export const useSetPreviewCheckered = () => useWorkshopLayoutStore((s) => s.setPreviewCheckered);
export const useSearchGame = () => useWorkshopLayoutStore((s) => s.searchGame);
export const useSetSearchGame = () => useWorkshopLayoutStore((s) => s.setSearchGame);
export const useSearchObjects = () => useWorkshopLayoutStore((s) => s.searchObjects);
export const useSetSearchObjects = () => useWorkshopLayoutStore((s) => s.setSearchObjects);
export const useForwardLookingMeta = () => useWorkshopLayoutStore((s) => s.forwardLookingMeta);
export const useSetForwardLookingMeta = () =>
  useWorkshopLayoutStore((s) => s.setForwardLookingMeta);
export const usePreviewGround = () => useWorkshopLayoutStore((s) => s.previewGround);
export const usePreviewMidlane = () => useWorkshopLayoutStore((s) => s.previewMidlane);
export const usePreviewGizmo = () => useWorkshopLayoutStore((s) => s.previewGizmo);
export const usePreviewStats = () => useWorkshopLayoutStore((s) => s.previewStats);
export const usePreviewCamera = () => useWorkshopLayoutStore((s) => s.previewCamera);
export const usePreviewWireframe = () => useWorkshopLayoutStore((s) => s.previewWireframe);
export const useTimelineHistogram = () => useWorkshopLayoutStore((s) => s.timelineHistogram);
export const useInspectorDefaults = () => useWorkshopLayoutStore((s) => s.inspectorDefaults);
export const useSetPreviewDisplay = () => useWorkshopLayoutStore((s) => s.setPreviewDisplay);
