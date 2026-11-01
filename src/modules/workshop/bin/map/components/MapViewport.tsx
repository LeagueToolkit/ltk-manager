import { useCallback, useMemo, useRef, useState } from "react";

import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, MapVariant } from "@/lib/tauri";
import {
  type Bounds,
  type CaptureFrame,
  FitCamera,
  FrameOnCommit,
  meshVisible,
  useBackdropSun,
  useHeldBackdropSource,
  useSceneColors,
} from "@/modules/viewport";
import {
  usePreviewAmbientOcclusion,
  usePreviewBackground,
  usePreviewBackdropEvents,
  usePreviewBackdropParticles,
  usePreviewBackdropSky,
  usePreviewBackdropStructures,
  usePreviewPostEffects,
  usePreviewShaders,
  usePreviewSun,
} from "@/stores";

import { useSandbox } from "../../../sandbox/state/SandboxContext";
import { usePaneCommands } from "../../menus/state/paneCommands";
import { Notice } from "../../shared/preview/Notice";
import { PreviewViewport } from "../../shared/preview/PreviewViewport";
import { useFitRequest } from "../../shared/preview/useFitRequest";
import { Passes } from "../../vfx/rendering/components/Passes";
import { passesOf } from "../../vfx/rendering/utils/passes";
import { useGeometryMeshes } from "../hooks/useGeometryMeshes";
import { useMapEditKeys } from "../hooks/useMapEditKeys";
import { useMapParticles } from "../hooks/useMapParticles";
import { useMeshImport } from "../hooks/useMeshImport";
import { usePlaceableActions } from "../hooks/usePlaceableActions";
import { useSunEdit } from "../hooks/useSunEdit";
import { useViewportEdits } from "../hooks/useViewportEdits";
import { isGizmoTool, useMapDragged, useMapScene } from "../state/mapScene";
import { MAP_PANE_COMMANDS } from "../utils/mapCommands";
import { meshIndexOf } from "../utils/meshSelection";
import { withDragged } from "../utils/placeableSpace";
import { BoxSelect } from "./BoxSelect";
import { CanvasClick } from "./CanvasClick";
import { GroundProbe, type GroundProbeFn } from "./GroundProbe";
import { ImportMeshDialog } from "./ImportMeshDialog";
import { MapCharacters } from "./MapCharacters";
import { MapFocus } from "./MapFocus";
import { MapMarkers } from "./MapMarkers";
import { MapParticles } from "./MapParticles";
import { ToolRail, TopRail } from "./MapToolbar";
import { MeshHighlight } from "./MeshHighlight";
import { PlaceableGizmo } from "./PlaceableGizmo";
import { usePlaceablePicking } from "./PlaceablePicking";
import { PlaceableShapes } from "./PlaceableShapes";
import { ReimportMeshDialog } from "./ReimportMeshDialog";
import { RenamePlaceableDialog } from "./RenamePlaceableDialog";
import { SunHandle } from "./SunHandle";

/**
 * What a free camera frames of a map, around where the middle of the map stands.
 *
 * A lane across with room over it. A whole map is past what the free presets dolly out
 * to, and the match camera frames nothing, standing a distance of its own off the point.
 */
const MAP_FRAME: Bounds = { min: [-1500, 0, -1500], max: [1500, 600, 1500] };

export interface MapViewportProps {
  /**
   * An open document of the project whose layer answers the map's materials first, and
   * null for a scene opened off a file, which resolves through the map's own open bin.
   */
  readonly document: BinDocumentId | null;
}

/**
 * The map a `Map`, a `MapSkin` or a `MapContainer` draws, with what it plays and stands.
 *
 * A `Map` draws one of the skins it lists, which the reader picks between. Which one, and
 * what the outliner hid and sent the camera to, is the `MapSceneHost` above it.
 */
export default function MapViewport({ document }: MapViewportProps) {
  const { variants, failed, chosen, located, geometry, hasMaterials, materials } = useMapScene();
  const resolver = document ?? materials;

  if (failed) return <Notice text={m.workshop_bin_map_preview_failed_empty()} />;
  if (variants === undefined) return <Notice text={m.workshop_bin_map_preview_loading_label()} />;
  if (chosen === null) return <Notice text={m.workshop_bin_map_preview_missing_empty()} />;
  /* The materials read is keyed on the document it resolves through, so the scene waits
     for the one it will keep rather than reading them twice. */
  if (!located || (hasMaterials && resolver === null)) {
    return <Notice text={m.workshop_bin_map_preview_loading_label()} />;
  }
  if (geometry === null) return <Notice text={m.workshop_bin_map_preview_no_geometry_empty()} />;
  return <MapScene document={resolver} geometry={geometry} variants={variants} chosen={chosen} />;
}

interface MapSceneProps {
  readonly document: BinDocumentId | null;
  /** The chosen variant's `.mapgeo`, wherever the scene found it. */
  readonly geometry: AssetRef;
  readonly variants: readonly MapVariant[];
  readonly chosen: MapVariant;
}

function MapScene({ document, geometry, variants, chosen }: MapSceneProps) {
  const { pick, materials, hidden, focus, selected, backdrop, editable, tool } = useMapScene();
  const { renaming, setRenaming, geometryEdited, geometryOpening, reimport } = useMapScene();
  const { space, snap, sunHandle, geometryDocument } = useMapScene();
  const dragged = useMapDragged();
  const box = useRef<HTMLDivElement>(null);
  const picking = usePlaceablePicking();
  const actions = usePlaceableActions();
  const meshes = useGeometryMeshes();
  const { visibility } = backdrop;
  const drawnVisibility = useMemo(() => {
    const hiddenMeshes = new Set<number>();
    for (const id of hidden) {
      const index = meshIndexOf(id);
      if (index !== null) hiddenMeshes.add(index);
    }
    return hiddenMeshes.size === 0 ? visibility : { ...visibility, hiddenMeshes };
  }, [visibility, hidden]);
  /* What a click can pick: the meshes the backdrop draws under the shown state. */
  const shownMesh = useCallback(
    (index: number) => {
      const mesh = meshes.drawn?.meshes[index];
      if (mesh === undefined || drawnVisibility.hiddenMeshes?.has(index) === true) return false;
      return meshVisible(drawnVisibility, mesh.visibility, mesh.controller);
    },
    [meshes.drawn, drawnVisibility],
  );
  const edits = useViewportEdits(actions, meshes, picking, shownMesh);
  const probe = useRef<GroundProbeFn | null>(null);
  const importer = useMeshImport(box, probe);
  const onKeyDown = useMapEditKeys(actions, meshes, edits.drop);
  const colors = useSceneColors();
  const shaders = usePreviewShaders();
  const sandbox = useSandbox();
  const source = useHeldBackdropSource(
    useMemo(
      () =>
        geometryOpening
          ? null
          : {
              map: chosen.map,
              document,
              geometry,
              shaders,
              edited: geometryEdited,
              ...(sandbox.kind === "layers" && { sandbox }),
            },
      [chosen.map, document, geometry, shaders, geometryEdited, geometryOpening, sandbox],
    ),
    chosen.map,
  );
  const clicks = !picking.boxing && (tool !== "place" || editable);

  const particles = usePreviewBackdropParticles();
  const structures = usePreviewBackdropStructures();
  const sky = usePreviewBackdropSky();
  const background = usePreviewBackground();
  const capture = useRef<CaptureFrame | null>(null);
  const sun = usePreviewSun();
  const postEffects = usePreviewPostEffects();
  const ambientOcclusion = usePreviewAmbientOcclusion();

  const [origin, setOrigin] = useState<readonly [number, number, number] | null>(null);
  const mapSun = useBackdropSun(source);
  const sunEdit = useSunEdit();
  const events = usePreviewBackdropEvents();
  const played = useMapParticles(particles ? materials : null, visibility, {
    hidden,
    events,
    picked: selected,
  });
  const { warps, softens } = useMemo(() => passesOf(played.map((group) => group.system)), [played]);

  const [fitToken, refit] = useFitRequest();

  usePaneCommands("map.viewport", {
    [MAP_PANE_COMMANDS.importMesh]: {
      run: editable && geometryDocument !== null ? () => void importer.pick() : null,
    },
    [MAP_PANE_COMMANDS.frameMap]: { run: refit },
    [MAP_PANE_COMMANDS.boxSelect]: {
      run: () => picking.setBoxing(!picking.boxing),
      checked: picking.boxing,
    },
    [MAP_PANE_COMMANDS.drop]: { run: edits.drop },
  });

  return (
    <>
      <div
        data-ui="MapViewport"
        className="flex min-h-0 flex-1 flex-col outline-none"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <TopRail
          picking={picking}
          source={source}
          variants={variants}
          chosen={chosen}
          onPick={pick}
          onAddMesh={() => void importer.pick()}
          onFrame={refit}
          capture={capture}
        />
        <div className="flex min-h-0 flex-1">
          <ToolRail picking={picking} />
          <div ref={box} data-ui="MapViewport:canvas" className="relative min-h-0 min-w-0 flex-1">
            <PreviewViewport
              gizmoCorner="bottom-right"
              renderer="shared"
              /* A still map with nothing animated in view draws no frames. The backdrop, the
             particles and the characters each request frames while they change. */
              frameloop="demand"
              stage={false}
              textured={false}
              backdrop={source}
              backdropVisibility={drawnVisibility}
              backdropSky={sky}
              background={background}
              captureRef={capture}
              sun={editable ? null : sun}
              postEffects={editable ? null : postEffects}
              ambientOcclusion={ambientOcclusion}
              onBackdropOrigin={setOrigin}
            >
              <FrameOnCommit />
              {origin !== null && <FitCamera bounds={MAP_FRAME} ground={origin} token={fitToken} />}
              <Passes warps={warps} softens={softens} />
              <MapParticles groups={played} />
              {structures && (
                <MapCharacters document={materials} visibility={visibility} hidden={hidden} />
              )}
              <MapFocus focus={focus} colors={colors} />
              {picking.shown && (
                <MapMarkers
                  items={picking.items}
                  hidden={hidden}
                  selected={selected}
                  colors={colors}
                  projector={picking.projector}
                />
              )}
              <PlaceableShapes
                items={picking.shown ? picking.items : withDragged(actions.selection, dragged)}
                hidden={hidden}
                selected={selected}
                colors={colors}
              />
              <MeshHighlight
                map={meshes.drawn}
                meshes={meshes.selection}
                dragged={dragged}
                colors={colors}
              />
              {sunHandle && sunEdit !== null && origin !== null && mapSun !== null && (
                <SunHandle
                  origin={origin}
                  direction={mapSun.direction}
                  color={colors.gizmo}
                  onCommit={sunEdit}
                />
              )}
              {editable && isGizmoTool(tool) && (
                <PlaceableGizmo
                  items={edits.gizmoItems}
                  tool={tool}
                  space={space}
                  snap={snap}
                  onCommit={edits.commit}
                  onDrag={edits.drag}
                />
              )}
              {clicks && <CanvasClick onClick={edits.click} />}
              <GroundProbe probe={probe} drawn={meshes.drawn} shown={shownMesh} />
            </PreviewViewport>
            {importer.request !== null && (
              <ImportMeshDialog
                key={importer.request.path}
                importer={importer}
                request={importer.request}
                backdrop={source}
              />
            )}
            {reimport !== null && <ReimportMeshDialog key={reimport.path} request={reimport} />}
            {renaming && actions.lead !== null && (
              <RenamePlaceableDialog
                key={actions.lead.id}
                placed={actions.lead}
                actions={actions}
                onClose={() => setRenaming(false)}
              />
            )}
            <BoxSelect target={box} active={picking.boxing} onBox={picking.onBox} />
            {origin === null && (
              <div className="pointer-events-none absolute inset-0 flex">
                <Notice text={m.workshop_bin_map_preview_loading_label()} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
