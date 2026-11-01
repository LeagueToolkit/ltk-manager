import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import {
  api,
  type AssetRef,
  type BinDocumentId,
  type MapGeometryEdit,
  type MapGeometryState,
  type MeshDelta,
  type MapPath,
  type MapVariant,
  type ObjectCreation,
  type PropertyEdit,
  type ReadOnly,
} from "@/lib/tauri";
import {
  type BackdropFlags,
  type BackdropSource,
  type EditedGeometry,
  useBackdropFlags,
  useHeldBackdropSource,
} from "@/modules/viewport";

import { assetKey } from "../../../preview/utils/assetRef";
import { useSandbox } from "../../../sandbox/state/SandboxContext";
import { binSaveKey, onBinEdit, queueForSave } from "../../../state";
import { useBinDocument } from "../../documents/hooks/useBinDocument";
import { useDocumentCall } from "../../documents/hooks/useDocumentCall";
import { lendHistory } from "../../documents/state/historyLoans";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { mapQueries } from "../api/mapQueries";
import { useGeometryDocument } from "../hooks/useGeometryDocument";
import { shiftMeshIds } from "../utils/geometryDeltas";
import { NO_FILTER, type OutlineFilter } from "../utils/mapOutline";
import { type SelectMode, selectedBy } from "../utils/mapSelection";
import { openingVariant } from "../utils/mapVariants";
import type { ReimportRequest } from "../utils/meshImport";

/**
 * What a press in the viewport does: pick, move, turn or scale the selection with a gizmo, or
 * place a new placeable.
 */
export type MapTool = "select" | "move" | "rotate" | "scale" | "place";

/** The file an edit of the map shell went to. */
type EditedFile = "bin" | "geometry" | "both";

/** Placeable transforms by `itemId`, column major in the engine's space. */
export type DraggedTransforms = ReadonlyMap<string, readonly (number | null)[]>;

/** The tools that draw a gizmo on the selection. */
export type GizmoTool = Extract<MapTool, "move" | "rotate" | "scale">;

/** Whether `tool` draws a gizmo on the selection. */
export function isGizmoTool(tool: MapTool): tool is GizmoTool {
  return tool === "move" || tool === "rotate" || tool === "scale";
}

/** The placeable the camera was last sent to, a new one per send so the same row sends twice. */
export interface MapFocus {
  readonly id: string;
  /** Where it stands in the map's space. */
  readonly position: readonly [number, number, number];
}

/** What names the map a scene draws: an object of a map's own classes, or one of its files. */
export type MapSceneSource =
  | {
      readonly kind: "object";
      readonly document: BinDocumentId;
      /** The `Map`, `MapSkin` or `MapContainer` object, and null where the view holds no row. */
      readonly entry: string | null;
    }
  | { readonly kind: "file"; readonly map: MapPath };

/** One map's scene, shared by the panes that draw it and list it. */
export interface MapSceneState {
  /** The maps the source draws, and undefined while they read. */
  readonly variants: readonly MapVariant[] | undefined;
  /** The variants could not be read. */
  readonly failed: boolean;
  /** The variant drawn, and null while the variants read and where the source names none. */
  readonly chosen: MapVariant | null;
  readonly pick: (map: MapPath) => void;
  /** Where the chosen variant's files live has been answered. */
  readonly located: boolean;
  /** The chosen variant's `.mapgeo`, and null where nothing holds one. */
  readonly geometry: AssetRef | null;
  /** The chosen variant's `.materials.bin` is one something holds, open or not yet. */
  readonly hasMaterials: boolean;
  /** The open `.materials.bin` of the chosen variant, and null until it is open. */
  readonly materials: BinDocumentId | null;
  /** Where that `.materials.bin` was read from, and null where nothing holds one. */
  readonly materialsAsset: AssetRef | null;
  /** The open `.materials.bin` takes edits: a layer file or a declared document. */
  readonly editable: boolean;
  /** Why the open `.materials.bin` takes no edits, and null where it takes them. */
  readonly readOnly: ReadOnly | null;
  /**
   * Creates `objects` and applies `edits` to the `.materials.bin` as one undo step, and
   * queues its save. Resolves false, after a toast, if the backend refuses them or the file
   * takes no edits.
   */
  readonly apply: (
    edits: readonly PropertyEdit[],
    objects?: readonly ObjectCreation[],
  ) => Promise<boolean>;
  readonly tool: MapTool;
  readonly setTool: (tool: MapTool) => void;
  /** The axes the gizmo moves along: the world's, or the lead's own. */
  readonly space: "world" | "local";
  readonly setSpace: (space: "world" | "local") => void;
  /** The gizmo snaps to the grid step. Ctrl during a drag inverts it. */
  readonly snap: boolean;
  readonly setSnap: (snap: boolean) => void;
  /** The class the Place tool adds. */
  readonly placeClass: string;
  readonly setPlaceClass: (className: string) => void;
  /** The chunk a new placeable goes into, by entry, and null for the chunk of the selection. */
  readonly target: string | null;
  readonly setTarget: (chunk: string | null) => void;
  readonly setDragged: (dragged: DraggedTransforms | null) => void;
  /** The `.mapgeo` open for edits, and null while the map takes no edits or it opens. */
  readonly geometryDocument: MapGeometryState | null;
  /** The open `.mapgeo` as the backdrop draws it, and null for the file. */
  readonly geometryEdited: EditedGeometry | null;
  /**
   * Which `.mapgeo` the backdrop draws is not known yet: the `.materials.bin` that decides
   * whether the map takes edits is not open, or the `.mapgeo` is being opened for edits. The
   * backdrop waits rather than reading the file first and the open document after, which reads
   * the whole map buffer twice.
   */
  readonly geometryOpening: boolean;
  /** Applies `edit` to the open `.mapgeo` as one undo step. */
  readonly editGeometry: (edit: MapGeometryEdit) => Promise<boolean>;
  /**
   * Creates `objects` in the `.materials.bin`, then applies the import `edit` to the `.mapgeo`,
   * as one undo step of the shell. Resolves with the mesh deltas, or null, after a toast, if
   * either file refused its part.
   */
  readonly importMeshes: (
    objects: readonly ObjectCreation[],
    edit: MapGeometryEdit,
  ) => Promise<readonly MeshDelta[] | null>;
  /**
   * Steps back or forward the edit of the shell made last, in the `.materials.bin` or the
   * `.mapgeo`. Resolves false, stepping nothing, if the shell recorded no edit to step.
   */
  readonly stepHistory: (undo: boolean) => Promise<boolean>;
  /** Whether the shell recorded an edit that the next undo or redo steps. */
  readonly stepsHistory: (undo: boolean) => boolean;
  /** Writes the open `.mapgeo` if it holds unsaved changes. */
  readonly saveGeometry: () => Promise<boolean>;
  /** The viewport draws the sun direction handle, while the Lighting pane shows its Sun section. */
  readonly sunHandle: boolean;
  readonly setSunHandle: (shown: boolean) => void;
  /** The rename dialog is open on the lead placeable. */
  readonly renaming: boolean;
  readonly setRenaming: (renaming: boolean) => void;
  /** The request of the open reimport dialog. `null` while the dialog is closed. */
  readonly reimport: ReimportRequest | null;
  readonly setReimport: (request: ReimportRequest | null) => void;
  /** The chunks and placeables the reader hid, by chunk entry and by `itemId`. */
  readonly hidden: ReadonlySet<string>;
  /** Hide or show one chunk or placeable, or several at once. */
  readonly setHidden: (ids: string | readonly string[], hidden: boolean) => void;
  readonly focus: MapFocus | null;
  readonly focusOn: (focus: MapFocus) => void;
  /** What the outliner lists, which the viewport's markers show the same of. */
  readonly filter: OutlineFilter;
  readonly setFilter: (filter: OutlineFilter) => void;
  /** The placeables the reader picked in the outliner or the viewport, by `itemId`. */
  readonly selected: ReadonlySet<string>;
  /** The placeable picked last, which the outliner scrolls to and the inspector shows. */
  readonly lead: string | null;
  readonly select: (ids: readonly string[], mode: SelectMode) => void;
  /** The viewport marks every placeable the outliner lists. */
  readonly markers: boolean;
  readonly setMarkers: (markers: boolean) => void;
  /**
   * The layers and the visibility controllers of the chosen variant, with the states that
   * the reader set. The preview draws by it and the Visibility pane edits it.
   */
  readonly backdrop: BackdropFlags;
}

const MapSceneContext = createContext<MapSceneState | null>(null);

/* Apart from the scene because a gizmo drag changes it per frame, and the menu bar reads the scene. */
const MapDraggedContext = createContext<DraggedTransforms | null>(null);

const NONE: ReadonlySet<string> = new Set();

/**
 * The transforms a gizmo drag gives the placeables it moves, by `itemId`, and null outside a
 * drag. A committed drag keeps them until the outline reads the edit back.
 */
export function useMapDragged(): DraggedTransforms | null {
  return use(MapDraggedContext);
}

/** The scene of the map in view, which a pane that draws or lists a map is always under. */
export function useMapScene(): MapSceneState {
  const scene = use(MapSceneContext);
  if (scene === null) throw new Error("useMapScene read outside a MapSceneHost");
  return scene;
}

export interface MapSceneHostProps {
  /** Off, this holds nothing and reads nothing. */
  readonly enabled?: boolean;
  readonly source: MapSceneSource;
  readonly children: ReactNode;
}

/**
 * The map scene above whatever draws it, so a change of frame keeps the skin the reader
 * picked and what they hid.
 *
 * It holds the chosen variant's `.materials.bin` open, because the preview and the
 * outliner both read that one file and neither outlives the other.
 */
export function MapSceneHost({ enabled = true, children, ...props }: MapSceneHostProps) {
  if (!enabled) return children;
  return <MapSceneProvider {...props}>{children}</MapSceneProvider>;
}

function MapSceneProvider({ source, children }: Omit<MapSceneHostProps, "enabled">) {
  const object = source.kind === "object" ? source : null;
  const read = useQuery(mapQueries.variants(object?.document ?? null, object?.entry ?? null));
  const file = source.kind === "file" ? source.map : null;
  const listed = useMemo<readonly MapVariant[] | undefined>(
    () =>
      file === null ? read.data : [{ skin: null, map: file, skinEntry: null, mapEntry: null }],
    [file, read.data],
  );
  const failed = read.error !== null;

  const [picked, setPicked] = useState<MapPath | null>(null);
  const chosen = useMemo(
    () =>
      listed === undefined
        ? null
        : (listed.find((variant) => variant.map === picked) ?? openingVariant(listed)),
    [listed, picked],
  );

  const sandbox = useSandbox();
  const files = useQuery(mapQueries.files(sandbox, chosen?.map ?? null)).data;
  const materialsFile = files?.materials ?? null;
  const [open, setOpen] = useState<OpenMaterials | null>(null);
  const opened = open?.document ?? null;
  const readOnly = open?.readOnly ?? null;
  const editable = open !== null && readOnly === null;

  const send = useDocumentCall(opened);
  const invalidate = useInvalidateBinReads();
  /* Which file each edit of the shell went to, so the undo keys step the one edited last. An
     edit typed into the inspector's tree is announced through `onBinEdit`. */
  const edited = useRef<{ undo: EditedFile[]; redo: EditedFile[] }>({
    undo: [],
    redo: [],
  });
  const saveKey = materialsFile === null ? null : binSaveKey(sandbox, materialsFile);
  useEffect(() => {
    if (saveKey === null) return;

    return onBinEdit(saveKey, () => {
      edited.current.undo.push("bin");
      edited.current.redo = [];
    });
  }, [saveKey]);
  const toast = useToast();
  const landed = useCallback(
    (id: BinDocumentId) => {
      if (materialsFile !== null) queueForSave(binSaveKey(sandbox, materialsFile), id);
      invalidate();
    },
    [materialsFile, sandbox, invalidate],
  );
  const apply = useCallback(
    async (edits: readonly PropertyEdit[], objects: readonly ObjectCreation[] = []) => {
      if (!editable) return false;
      if (edits.length === 0 && objects.length === 0) return true;

      const { result, id } = await send((id) =>
        api.bin.edit(
          id,
          objects.length === 0
            ? { kind: "editProperties", edits: [...edits] }
            : { kind: "createAndEdit", objects: [...objects], edits: [...edits] },
        ),
      );
      if (!result.ok) {
        toast.error(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
        return false;
      }

      landed(id);
      edited.current.undo.push("bin");
      edited.current.redo = [];
      return true;
    },
    [editable, send, landed, toast],
  );

  const [hidden, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(NONE);
  const [lead, setLead] = useState<string | null>(null);
  /* A removal or an insert renumbers the meshes after it, and the ids that name them. */
  const renumber = useCallback((deltas: readonly MeshDelta[]) => {
    if (deltas.every((delta) => delta.kind === "update")) return;

    setHiddenIds((held) => shiftMeshIds(held, deltas));
    setSelected((held) => shiftMeshIds(held, deltas));
    setLead((held) =>
      held === null ? null : ([...shiftMeshIds(new Set([held]), deltas)][0] ?? null),
    );
  }, []);

  const geometryFile = files?.geometry ?? null;
  const geometryPath = chosen === null ? null : `data/${chosen.map.toLowerCase()}.mapgeo`;
  const geometryTarget = useMemo(
    () => ({ materials: opened, path: geometryPath }),
    [opened, geometryPath],
  );
  /* A subset keeps the document open, because closing it reads the whole map from the file. */
  const geometry = useGeometryDocument(
    geometryFile,
    editable || readOnly === "layerSubset",
    geometryTarget,
  );
  const editGeometry = useCallback(
    async (change: MapGeometryEdit) => {
      const deltas = await geometry.edit(change);
      if (deltas === null) return false;

      renumber(deltas);
      edited.current.undo.push("geometry");
      edited.current.redo = [];
      return true;
    },
    [geometry, renumber],
  );
  /* Steps the `.materials.bin`, and answers whether its history held a step. */
  const stepBin = useCallback(
    async (undo: boolean) => {
      const run = undo ? api.bin.undo : api.bin.redo;
      const { result, id } = await send((id) => run(id));
      if (!result.ok) {
        const title = undo
          ? m.workshop_bin_undo_failed_title()
          : m.workshop_bin_redo_failed_title();
        toast.error(title, errorSummary(result.error));
        return true;
      }
      if (result.value === null) return false;

      landed(id);
      return true;
    },
    [send, landed, toast],
  );
  const stepHistory = useCallback(
    async (undo: boolean) => {
      const stack = undo ? edited.current.undo : edited.current.redo;
      const file = stack.pop();
      if (file === undefined) return false;

      (undo ? edited.current.redo : edited.current.undo).push(file);
      if (file === "bin") return stepBin(undo);
      /* An import steps the meshes before the materials that they draw with. */
      if (file === "both" && !undo) await stepBin(undo);

      const deltas = await geometry.step(undo);
      if (deltas !== null) renumber(deltas);
      if (file === "both" && undo) await stepBin(undo);
      return true;
    },
    [geometry, renumber, stepBin],
  );
  const importMeshes = useCallback(
    async (objects: readonly ObjectCreation[], change: MapGeometryEdit) => {
      if (!editable) return null;

      if (objects.length > 0) {
        const { result, id } = await send((id) =>
          api.bin.edit(id, { kind: "createAndEdit", objects: [...objects], edits: [] }),
        );
        if (!result.ok) {
          toast.error(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
          return null;
        }
        landed(id);
      }

      const deltas = await geometry.edit(change);
      if (deltas === null) {
        if (objects.length > 0) await stepBin(true);
        return null;
      }

      renumber(deltas);
      edited.current.undo.push(objects.length > 0 ? "both" : "geometry");
      edited.current.redo = [];
      return deltas;
    },
    [editable, send, landed, toast, geometry, renumber, stepBin],
  );
  const stepsHistory = useCallback(
    (undo: boolean) => (undo ? edited.current.undo : edited.current.redo).length > 0,
    [],
  );
  const saveGeometry = geometry.save;

  /* An object tab's undo keys step the edits of the shell first, which its own history does
     not hold when the tab is a `Map` or a `MapSkin` of another file. */
  const owner = object?.document ?? null;
  useEffect(() => {
    if (owner === null || !editable) return;

    return lendHistory(owner, async (step) => {
      const undo = step === "undo";
      if (await stepHistory(undo)) return true;
      return stepBin(undo);
    });
  }, [owner, editable, stepHistory, stepBin]);

  const [tool, setTool] = useState<MapTool>("select");
  const [space, setSpace] = useState<"world" | "local">("world");
  const [snap, setSnap] = useState(false);
  const [placeClass, setPlaceClass] = useState("MapParticle");
  const [target, setTarget] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [reimport, setReimport] = useState<ReimportRequest | null>(null);
  const [sunHandle, setSunHandle] = useState(false);
  const [dragged, setDragged] = useState<DraggedTransforms | null>(null);
  const outline = useQuery(mapQueries.outline(materialsFile === null ? null : opened)).data;
  useEffect(() => setDragged(null), [outline]);

  /* The same map, document and geometry that the viewport draws its backdrop from, so the
     two share one read of the geometry and one of the model. Null until the viewport
     would draw, which is when the document that resolves the materials is known. */
  const resolver = object?.document ?? opened;
  const geometryId = geometry.state?.id ?? null;
  const geometryEdited = useMemo<EditedGeometry | null>(
    () => (geometryId === null ? null : { document: geometryId }),
    [geometryId],
  );
  /* A reopened `.mapgeo`, such as the layer copy a save of a game file lands as, holds no
     history, so the steps recorded against the last one go. */
  useEffect(() => {
    const keep = (files: EditedFile[]) => files.filter((file) => file !== "geometry");
    edited.current = {
      undo: keep(edited.current.undo),
      redo: keep(edited.current.redo),
    };
  }, [geometryId]);
  const geometryOpening = (materialsFile !== null && opened === null) || geometry.opening;
  const backdropSource = useMemo<BackdropSource | null>(() => {
    if (chosen === null || geometryFile === null) return null;
    if (materialsFile !== null && resolver === null) return null;
    if (geometryOpening) return null;

    return {
      map: chosen.map,
      document: resolver,
      geometry: geometryFile,
      edited: geometryEdited,
      skin: chosen.skin,
      ...(sandbox.kind === "layers" && { sandbox }),
    };
  }, [chosen, geometryFile, materialsFile, resolver, geometryOpening, geometryEdited, sandbox]);
  const backdrop = useBackdropFlags(useHeldBackdropSource(backdropSource, chosen?.map ?? null));

  const setHidden = useCallback((ids: string | readonly string[], hide: boolean) => {
    setHiddenIds((held) => {
      const next = new Set(held);
      for (const id of typeof ids === "string" ? [ids] : ids) {
        if (hide) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [filter, setFilter] = useState<OutlineFilter>(NO_FILTER);
  const [markers, setMarkers] = useState(false);
  const select = useCallback((ids: readonly string[], mode: SelectMode) => {
    setSelected((held) => selectedBy(held, ids, mode));
    setLead((held) => ids[0] ?? (mode === "replace" ? null : held));
  }, []);
  const pick = useCallback((map: MapPath) => {
    setPicked(map);
    setFocus(null);
    setSelected(NONE);
    setLead(null);
    setTarget(null);
  }, []);

  const scene = useMemo<MapSceneState>(
    () => ({
      variants: listed,
      failed,
      chosen,
      pick,
      located: files !== undefined,
      geometry: files?.geometry ?? null,
      hasMaterials: materialsFile !== null,
      materials: materialsFile === null ? null : opened,
      materialsAsset: materialsFile,
      editable,
      readOnly,
      apply,
      tool,
      setTool,
      space,
      setSpace,
      snap,
      setSnap,
      placeClass,
      setPlaceClass,
      target,
      setTarget,
      setDragged,
      renaming,
      setRenaming,
      reimport,
      setReimport,
      sunHandle,
      setSunHandle,
      geometryDocument: geometry.state,
      geometryEdited,
      geometryOpening,
      editGeometry,
      importMeshes,
      stepHistory,
      stepsHistory,
      saveGeometry,
      hidden,
      setHidden,
      focus,
      focusOn: setFocus,
      filter,
      setFilter,
      selected,
      lead,
      select,
      markers,
      setMarkers,
      backdrop,
    }),
    [
      listed,
      failed,
      chosen,
      pick,
      files,
      materialsFile,
      opened,
      editable,
      readOnly,
      apply,
      tool,
      space,
      snap,
      placeClass,
      target,
      renaming,
      reimport,
      sunHandle,
      geometry.state,
      geometryEdited,
      geometryOpening,
      editGeometry,
      importMeshes,
      stepHistory,
      stepsHistory,
      saveGeometry,
      hidden,
      setHidden,
      focus,
      filter,
      selected,
      lead,
      select,
      markers,
      backdrop,
    ],
  );

  return (
    <MapSceneContext value={scene}>
      <MapDraggedContext value={dragged}>
        {materialsFile !== null && (
          /* Keyed, so a change of map lets the last handle go before the next answers. */
          <MaterialsOpener key={assetKey(materialsFile)} asset={materialsFile} onOpen={setOpen} />
        )}
        {children}
      </MapDraggedContext>
    </MapSceneContext>
  );
}

/** The `.materials.bin` of a scene once it is open, and why it takes no edits where it takes none. */
interface OpenMaterials {
  readonly document: BinDocumentId;
  readonly readOnly: ReadOnly | null;
}

/** Holds `asset` open for as long as this is mounted, its handle reported to the owner. */
function MaterialsOpener({
  asset,
  onOpen,
}: {
  asset: AssetRef;
  onOpen: (open: OpenMaterials | null) => void;
}) {
  const { state } = useBinDocument(asset);
  const document = state.status === "open" ? state.handle.document : null;
  const readOnly = state.status === "open" ? state.handle.readOnly : null;

  useEffect(() => {
    onOpen(document === null ? null : { document, readOnly });
    return () => onOpen(null);
  }, [document, readOnly, onOpen]);
  return null;
}
