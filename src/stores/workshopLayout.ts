import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MapPath } from "@/lib/tauri";
import type {
  AmbientOcclusion,
  AntiAliasing,
  CameraPreset,
  PlacementMode,
  PostEffects,
  PreviewShape,
  SunOverride,
  ViewMode,
} from "@/modules/viewport";

import { keepUnversioned } from "./storage";

/** Which edge of the content browser the primary side panel docks to. */
type LayerPanelSide = "left" | "right";
type WadSort = "name" | "size";

/** Which view the rail has the primary side panel showing, ADR-0038. */
type SidebarViewId =
  | "explorer"
  | "search"
  | "problems"
  | "objects"
  | "declarations"
  | "game"
  | "source";

/** An Effects Quality level of the client, 0 for Very Low to 4 for Very High. */
type PreviewEffectsQuality = 0 | 1 | 2 | 3 | 4;

/**
 * What a viewport draws around the run, and how the inspector lists a class.
 *
 * Display preferences, app-wide and persisted beside `previewCheckered` (ADR-0037). The
 * run itself - the seed, the rig, the playhead - is kept per system for the session.
 */
interface PreviewDisplay {
  /** Six hex digits that the skin and map viewports clear to, and null for the theme's color. */
  previewBackground: string | null;
  /** The ground and its grid are drawn. */
  previewGround: boolean;
  /** The ground wears the midlane's texture. */
  previewMidlane: boolean;
  /** Which map is drawn behind the subject, by its entry path, and null for the flat stage. */
  previewBackdrop: MapPath | null;
  /** The backdrop plays the particle systems its map stands in it. */
  previewBackdropParticles: boolean;
  /** The backdrop also plays the particle systems a script or a visibility controller turns on. */
  previewBackdropEvents: boolean;
  /** The backdrop stands the structures and the level props its map places. */
  previewBackdropStructures: boolean;
  /** The backdrop draws the sky cube map behind its map. */
  previewBackdropSky: boolean;
  /** The sun control's fields over every backdrop's own sun, and null for each map's own. */
  previewSun: SunOverride | null;
  /** The post effects of every backdrop, and null for each map's own. */
  previewPostEffects: PostEffects | null;
  /** The ambient occlusion of every backdrop, and null for each map's own. */
  previewAmbientOcclusion: AmbientOcclusion | null;
  /** How every viewport smooths the edges of its finished frame. */
  previewAntiAliasing: AntiAliasing;
  /** The selected emitter's origin, offset and spawn shape are drawn as a wireframe. */
  previewGizmo: boolean;
  /** The VFX viewport draws a gizmo that moves the rig's target. Not persisted. */
  previewTargetHandle: boolean;
  /** Each emitter that writes a stencil mask draws the mask as a tint. */
  previewMasks: boolean;
  /**
   * The client's Effects Quality every particle preview simulates, from 0 for Very Low to 4
   * for Very High.
   */
  previewEffectsQuality: PreviewEffectsQuality;
  /** The live counts and the frame's milliseconds are drawn in the corner. */
  previewStats: boolean;
  /** A character's skeleton is drawn over it, a dot per joint and a line to its parent. */
  previewArmature: boolean;
  /** A character's materials draw with the game's own shaders, translated. */
  previewShaders: boolean;
  /** A skin's `CharacterOutlineCategory` outline is drawn around it. */
  previewOutlines: boolean;
  /** Each joint's name is written beside its dot. */
  previewJointNames: boolean;
  /** A skin's dynamics and sockets are drawn over it, as far as the three below allow. */
  previewPhysics: boolean;
  /** The dynamics overlay draws the simulated joints, their radii, links and ground. */
  previewSimulatedJoints: boolean;
  /** The dynamics overlay draws the colliders. */
  previewColliders: boolean;
  /** The dynamics overlay draws each socket's axes. */
  previewSockets: boolean;
  /** The camera a viewport opens on, "The viewer" in docs/ux/BIN_EDITOR.md. */
  previewCamera: CameraPreset;
  /** How a viewport draws its meshes, "The view mode menu" in docs/ux/BIN_EDITOR.md. */
  previewViewMode: ViewMode;
  /** The triangle edges draw over a lit or untextured scene. */
  previewWireOverlay: boolean;
  /** The subject carries a gizmo that moves it around the scene. */
  previewMove: boolean;
  /** Which drag the gizmo does. */
  previewMoveMode: PlacementMode;
  /** Where the subject stands, and null to stand it in the backdrop's own middle. */
  previewPlacement: [number, number, number] | null;
  /**
   * Which backdrop `previewPlacement` was dragged on.
   *
   * A placement is a point on one map, so it means nothing on another. A backdrop that
   * does not match this one stands the subject in its own middle instead.
   */
  previewPlacedOn: MapPath | null;
  /** The subject's yaw in radians. */
  previewFacing: number;
  /** The shape a material view draws its material on. */
  previewMaterialShape: PreviewShape;
  /** A material view turns its shape about the up axis. */
  previewTurntable: boolean;
  /** A material view draws a shape in place of the character of its own file. */
  previewMaterialOnShape: boolean;
  /** The timeline's lanes draw each emitter's live particles per step over its bar. */
  timelineHistogram: boolean;
  /** A dragged or scrubbed time on the timeline snaps to its markers, edges and ticks. */
  timelineSnap: boolean;
  /** The inspector lists every field the class declares, the unauthored ones dimmed. */
  inspectorDefaults: boolean;
  /** The particle graph draws its minimap while a part of the graph is outside the view. */
  graphMinimap: boolean;
  /** A viewport plays the sound events of what it plays. */
  previewSound: boolean;
  /** The gain of every viewport's sound, from 0 to 1. */
  previewSoundVolume: number;
}
/** A preview display preference that is a switch. */
type PreviewFlag = {
  [K in keyof PreviewDisplay]: PreviewDisplay[K] extends boolean ? K : never;
}[keyof PreviewDisplay];

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

/** The heights a tree row draws at while it draws thumbnails. */
const EXPLORER_TREE_ROW_HEIGHTS = [20, 26, 32, 48, 64] as const;
type ExplorerTreeRowHeight = (typeof EXPLORER_TREE_ROW_HEIGHTS)[number];

/** A tree thumbnail's box: a square, or the image's own aspect ratio. */
type ExplorerArtShape = "square" | "original";

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
  /**
   * Whether a single click on a tree row opens the file as the replaceable tab.
   *
   * On, a click previews and a double click keeps what it opened, which is how
   * a reader walks a directory one file at a time. Off, a click selects the row
   * alone and a double click opens a tab of its own.
   */
  previewOnClick: boolean;
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
  /** The inspector pane beside the event tree of an event bank is shown. */
  audioInspector: boolean;
  /** The shared geometry and artwork preferences of the explorers. */
  explorerView: ExplorerView;
  explorerTileSize: ExplorerTileSize;
  explorerRowHeight: ExplorerRowHeight;
  explorerThumbnails: boolean;
  /** The tree's own switch, apart from the grid's, because thumbnails make every tree row taller. */
  explorerTreeThumbnails: boolean;
  explorerTreeRowHeight: ExplorerTreeRowHeight;
  explorerTreeArtShape: ExplorerArtShape;
  explorerColumns: ExplorerColumns;
  setExplorerView: (explorerView: ExplorerView) => void;
  setExplorerTileSize: (explorerTileSize: ExplorerTileSize) => void;
  setExplorerRowHeight: (explorerRowHeight: ExplorerRowHeight) => void;
  setExplorerThumbnails: (explorerThumbnails: boolean) => void;
  setExplorerTreeThumbnails: (explorerTreeThumbnails: boolean) => void;
  setExplorerTreeRowHeight: (explorerTreeRowHeight: ExplorerTreeRowHeight) => void;
  setExplorerTreeArtShape: (explorerTreeArtShape: ExplorerArtShape) => void;
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
  setPreviewOnClick: (previewOnClick: boolean) => void;
  setPreviewCheckered: (previewCheckered: boolean) => void;
  setSearchGame: (searchGame: boolean) => void;
  setSearchObjects: (searchObjects: boolean) => void;
  setForwardLookingMeta: (forwardLookingMeta: boolean) => void;
  setAudioInspector: (audioInspector: boolean) => void;
  setPreviewDisplay: (display: Partial<PreviewDisplay>) => void;
}

/** The view mode and overlay each value of the wireframe setting they replaced draws as. */
const WIREFRAME_VIEW = {
  off: ["lit", false],
  only: ["wireframe", false],
  overlay: ["lit", true],
} as const satisfies Record<string, readonly [ViewMode, boolean]>;

/** The map the backdrop was fixed to, as the game index spells its entry path. */
const SUMMONERS_RIFT = "maps/mapgeometry/map11/base_srx";

const PREVIEW_DISPLAY_DEFAULTS: PreviewDisplay = {
  previewBackground: null,
  previewGround: true,
  previewMidlane: true,
  previewBackdrop: null,
  previewBackdropParticles: true,
  previewBackdropEvents: false,
  previewBackdropStructures: true,
  previewBackdropSky: true,
  previewSun: null,
  previewPostEffects: null,
  previewAmbientOcclusion: null,
  /* The game's own default, `DEFAULT_ANTI_ALIASING`, kept a literal so the store loads no renderer. */
  previewAntiAliasing: "fxaa",
  previewGizmo: true,
  previewTargetHandle: false,
  previewMasks: false,
  previewEffectsQuality: 4,
  previewStats: false,
  previewArmature: false,
  previewShaders: false,
  previewJointNames: false,
  previewOutlines: true,
  previewPhysics: true,
  previewSimulatedJoints: true,
  previewColliders: true,
  previewSockets: true,
  previewCamera: "game",
  previewViewMode: "lit",
  previewWireOverlay: false,
  previewMove: false,
  previewMoveMode: "translate",
  previewPlacement: null,
  previewPlacedOn: null,
  previewFacing: 0,
  previewMaterialShape: "sphere",
  previewTurntable: false,
  previewMaterialOnShape: false,
  timelineHistogram: false,
  timelineSnap: true,
  inspectorDefaults: false,
  graphMinimap: true,
  previewSound: false,
  /* `PREVIEW_VOLUME` of the audio module, kept a literal so the store loads no player. */
  previewSoundVolume: 0.2,
};

/* What the Project editor card shows. The rest of this store is geometry, which is
   remembered rather than chosen, so a settings key exists only for these four. */
const PROJECT_EDITOR_DEFAULTS = {
  previewOnClick: true,
  searchGame: true,
  searchObjects: false,
  forwardLookingMeta: true,
} satisfies Pick<
  WorkshopLayoutStore,
  "previewOnClick" | "searchGame" | "searchObjects" | "forwardLookingMeta"
>;

type ProjectEditorKey = keyof typeof PROJECT_EDITOR_DEFAULTS;

/* The viewport preferences the settings page shows beside the Project editor card's. */
const VIEWPORT_SETTING_DEFAULTS = {
  previewSound: PREVIEW_DISPLAY_DEFAULTS.previewSound,
  previewSoundVolume: PREVIEW_DISPLAY_DEFAULTS.previewSoundVolume,
} satisfies Pick<PreviewDisplay, "previewSound" | "previewSoundVolume">;

/** Every key of this store that the settings page addresses as `layout.<key>`. */
const LAYOUT_SETTING_DEFAULTS = { ...PROJECT_EDITOR_DEFAULTS, ...VIEWPORT_SETTING_DEFAULTS };

type LayoutSettingKey = keyof typeof LAYOUT_SETTING_DEFAULTS;

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
      audioInspector: false,
      explorerView: "tree",
      explorerTileSize: 128,
      explorerRowHeight: 24,
      explorerThumbnails: true,
      explorerTreeThumbnails: false,
      explorerTreeRowHeight: 48,
      explorerTreeArtShape: "square",
      explorerColumns: { size: 88, kind: 112 },
      ...PROJECT_EDITOR_DEFAULTS,
      ...PREVIEW_DISPLAY_DEFAULTS,
      setExplorerView: (explorerView) => set({ explorerView }),
      setExplorerTileSize: (explorerTileSize) => set({ explorerTileSize }),
      setExplorerRowHeight: (explorerRowHeight) => set({ explorerRowHeight }),
      setExplorerThumbnails: (explorerThumbnails) => set({ explorerThumbnails }),
      setExplorerTreeThumbnails: (explorerTreeThumbnails) => set({ explorerTreeThumbnails }),
      setExplorerTreeRowHeight: (explorerTreeRowHeight) => set({ explorerTreeRowHeight }),
      setExplorerTreeArtShape: (explorerTreeArtShape) => set({ explorerTreeArtShape }),
      /* One column rather than the record, so a drag's writer is stable across
         the re-renders the drag itself causes. */
      setExplorerColumn: (column, width) =>
        set((state) => ({
          explorerColumns: { ...state.explorerColumns, [column]: width },
        })),
      setLayerPanelSide: (layerPanelSide) => set({ layerPanelSide }),
      setLayerPanelOpen: (layerPanelOpen) => set({ layerPanelOpen }),
      showSidebarView: (sidebarView) => set({ layerPanelOpen: true, sidebarView }),
      toggleSection: (id, open) =>
        set((state) => ({
          openSections: { ...state.openSections, [id]: open },
        })),
      setSectionHeight: (id, height) =>
        set((state) => ({
          sectionHeights: { ...state.sectionHeights, [id]: height },
        })),
      setBrowserSplit: (browserSplit) => set({ browserSplit }),
      setShowLayerStats: (showLayerStats) => set({ showLayerStats }),
      setWadSort: (wadSort) => set({ wadSort }),
      setPreviewOnClick: (previewOnClick) => set({ previewOnClick }),
      setPreviewCheckered: (previewCheckered) => set({ previewCheckered }),
      setSearchGame: (searchGame) => set({ searchGame }),
      setSearchObjects: (searchObjects) => set({ searchObjects }),
      setForwardLookingMeta: (forwardLookingMeta) => set({ forwardLookingMeta }),
      setAudioInspector: (audioInspector) => set({ audioInspector }),
      setPreviewDisplay: (display) => set(display),
    }),
    {
      name: "ltk-workshop-layout",
      version: 11,
      partialize: ({ previewTargetHandle: _session, ...kept }) => kept,
      migrate: (persisted, version) => {
        const state = {
          ...keepUnversioned<
            WorkshopLayoutStore & {
              explorerSort?: ExplorerSort;
              tabOpenMode?: string;
              previewWireframe?: keyof typeof WIREFRAME_VIEW;
            }
          >(persisted),
        };
        delete state.explorerSort;
        /* The mode a click used to carry is now what a click does, and every
           editor takes the new default rather than the value it never chose. */
        delete state.tabOpenMode;
        /* The one map the backdrop could draw was named rather than addressed, and the
           picker addresses every map by the entry path the index spells. */
        if ((state.previewBackdrop as string | null) === "summonersRift") {
          state.previewBackdrop = SUMMONERS_RIFT;
        }
        /* A placement used to be one point for every map, which now belongs to the map
           it was dragged on, so the old one has no map to belong to. */
        if (state.previewPlacement != null) {
          state.previewPlacement = null;
          state.previewPlacedOn = null;
        }
        if (state.previewWireframe !== undefined) {
          const [mode, overlay] = WIREFRAME_VIEW[state.previewWireframe] ?? WIREFRAME_VIEW.off;
          state.previewViewMode = mode;
          state.previewWireOverlay = overlay;
          delete state.previewWireframe;
        }
        /* The overlay was a view mode of its own before it drew over untextured too. */
        if ((state.previewViewMode as string | undefined) === "overlay") {
          state.previewViewMode = "lit";
          state.previewWireOverlay = true;
        }
        if (state.previewTargetHandle) state.previewTargetHandle = false;
        if (version < 11) state.audioInspector = false;
        return state;
      },
    },
  ),
);

export {
  EXPLORER_ROW_HEIGHTS,
  EXPLORER_TILE_SIZES,
  EXPLORER_TREE_ROW_HEIGHTS,
  LAYOUT_SETTING_DEFAULTS,
  PREVIEW_DISPLAY_DEFAULTS,
  PROJECT_EDITOR_DEFAULTS,
};
export type {
  ExplorerArtShape,
  ExplorerColumns,
  ExplorerRowHeight,
  ExplorerSort,
  ExplorerSortDirection,
  ExplorerSortField,
  ExplorerTileSize,
  ExplorerTreeRowHeight,
  ExplorerView,
  LayerPanelSide,
  LayoutSettingKey,
  PreviewDisplay,
  PreviewEffectsQuality,
  PreviewFlag,
  ProjectEditorKey,
  SidebarViewId,
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
export const useExplorerTreeThumbnails = () =>
  useWorkshopLayoutStore((s) => s.explorerTreeThumbnails);
export const useSetExplorerTreeThumbnails = () =>
  useWorkshopLayoutStore((s) => s.setExplorerTreeThumbnails);
export const useExplorerTreeRowHeight = () =>
  useWorkshopLayoutStore((s) => s.explorerTreeRowHeight);
export const useSetExplorerTreeRowHeight = () =>
  useWorkshopLayoutStore((s) => s.setExplorerTreeRowHeight);
export const useExplorerTreeArtShape = () => useWorkshopLayoutStore((s) => s.explorerTreeArtShape);
export const useSetExplorerTreeArtShape = () =>
  useWorkshopLayoutStore((s) => s.setExplorerTreeArtShape);
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
export const usePreviewOnClick = () => useWorkshopLayoutStore((s) => s.previewOnClick);
export const useSetPreviewOnClick = () => useWorkshopLayoutStore((s) => s.setPreviewOnClick);
export const usePreviewCheckered = () => useWorkshopLayoutStore((s) => s.previewCheckered);
export const useSetPreviewCheckered = () => useWorkshopLayoutStore((s) => s.setPreviewCheckered);
export const useSearchGame = () => useWorkshopLayoutStore((s) => s.searchGame);
export const useSetSearchGame = () => useWorkshopLayoutStore((s) => s.setSearchGame);
export const useSearchObjects = () => useWorkshopLayoutStore((s) => s.searchObjects);
export const useSetSearchObjects = () => useWorkshopLayoutStore((s) => s.setSearchObjects);
export const useForwardLookingMeta = () => useWorkshopLayoutStore((s) => s.forwardLookingMeta);
export const useSetForwardLookingMeta = () =>
  useWorkshopLayoutStore((s) => s.setForwardLookingMeta);
export const useAudioInspector = () => useWorkshopLayoutStore((s) => s.audioInspector);
export const useSetAudioInspector = () => useWorkshopLayoutStore((s) => s.setAudioInspector);
export const usePreviewBackground = () => useWorkshopLayoutStore((s) => s.previewBackground);
export const usePreviewGround = () => useWorkshopLayoutStore((s) => s.previewGround);
export const usePreviewMidlane = () => useWorkshopLayoutStore((s) => s.previewMidlane);
export const usePreviewBackdrop = () => useWorkshopLayoutStore((s) => s.previewBackdrop);
export const usePreviewBackdropParticles = () =>
  useWorkshopLayoutStore((s) => s.previewBackdropParticles);
export const usePreviewBackdropEvents = () =>
  useWorkshopLayoutStore((s) => s.previewBackdropEvents);
export const usePreviewBackdropStructures = () =>
  useWorkshopLayoutStore((s) => s.previewBackdropStructures);
export const usePreviewBackdropSky = () => useWorkshopLayoutStore((s) => s.previewBackdropSky);
export const usePreviewSun = () => useWorkshopLayoutStore((s) => s.previewSun);
export const usePreviewPostEffects = () => useWorkshopLayoutStore((s) => s.previewPostEffects);
export const usePreviewAntiAliasing = () => useWorkshopLayoutStore((s) => s.previewAntiAliasing);
export const usePreviewAmbientOcclusion = () =>
  useWorkshopLayoutStore((s) => s.previewAmbientOcclusion);
export const usePreviewGizmo = () => useWorkshopLayoutStore((s) => s.previewGizmo);
export const usePreviewTargetHandle = () => useWorkshopLayoutStore((s) => s.previewTargetHandle);
export const usePreviewMasks = () => useWorkshopLayoutStore((s) => s.previewMasks);
export const usePreviewEffectsQuality = () =>
  useWorkshopLayoutStore((s) => s.previewEffectsQuality);
export const usePreviewStats = () => useWorkshopLayoutStore((s) => s.previewStats);
export const usePreviewArmature = () => useWorkshopLayoutStore((s) => s.previewArmature);
export const usePreviewShaders = () => useWorkshopLayoutStore((s) => s.previewShaders);
export const usePreviewOutlines = () => useWorkshopLayoutStore((s) => s.previewOutlines);
export const usePreviewJointNames = () => useWorkshopLayoutStore((s) => s.previewJointNames);
export const usePreviewPhysics = () => useWorkshopLayoutStore((s) => s.previewPhysics);
export const usePreviewSimulatedJoints = () =>
  useWorkshopLayoutStore((s) => s.previewSimulatedJoints);
export const usePreviewColliders = () => useWorkshopLayoutStore((s) => s.previewColliders);
export const usePreviewSockets = () => useWorkshopLayoutStore((s) => s.previewSockets);
export const usePreviewCamera = () => useWorkshopLayoutStore((s) => s.previewCamera);
export const usePreviewViewMode = () => useWorkshopLayoutStore((s) => s.previewViewMode);
export const usePreviewWireOverlay = () => useWorkshopLayoutStore((s) => s.previewWireOverlay);
export const usePreviewMove = () => useWorkshopLayoutStore((s) => s.previewMove);
export const usePreviewMoveMode = () => useWorkshopLayoutStore((s) => s.previewMoveMode);
export const usePreviewPlacement = () => useWorkshopLayoutStore((s) => s.previewPlacement);
export const usePreviewPlacedOn = () => useWorkshopLayoutStore((s) => s.previewPlacedOn);
export const usePreviewFacing = () => useWorkshopLayoutStore((s) => s.previewFacing);
export const usePreviewMaterialShape = () => useWorkshopLayoutStore((s) => s.previewMaterialShape);
export const usePreviewTurntable = () => useWorkshopLayoutStore((s) => s.previewTurntable);
export const usePreviewMaterialOnShape = () =>
  useWorkshopLayoutStore((s) => s.previewMaterialOnShape);
export const useTimelineHistogram = () => useWorkshopLayoutStore((s) => s.timelineHistogram);
export const useTimelineSnap = () => useWorkshopLayoutStore((s) => s.timelineSnap);
export const useInspectorDefaults = () => useWorkshopLayoutStore((s) => s.inspectorDefaults);
export const useGraphMinimap = () => useWorkshopLayoutStore((s) => s.graphMinimap);
export const usePreviewSound = () => useWorkshopLayoutStore((s) => s.previewSound);
export const usePreviewSoundVolume = () => useWorkshopLayoutStore((s) => s.previewSoundVolume);
export const useSetPreviewDisplay = () => useWorkshopLayoutStore((s) => s.setPreviewDisplay);
export const usePreviewFlag = (flag: PreviewFlag) => useWorkshopLayoutStore((s) => s[flag]);
