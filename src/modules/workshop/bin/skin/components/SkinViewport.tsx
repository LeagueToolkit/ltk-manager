import {
  ArrowsClockwiseIcon,
  ArrowsOutCardinalIcon,
  BoneIcon,
  CaretDownIcon,
  EyeSlashIcon,
  FrameCornersIcon,
  GridFourIcon,
  MapTrifoldIcon,
  MountainsIcon,
  SparkleIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useFrame } from "@react-three/fiber";
import { useQueries, useQuery } from "@tanstack/react-query";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ButtonGroup, HexshadeIcon, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, GraphClip, MapPath, SkinModel } from "@/lib/tauri";
import {
  Armature,
  type BackdropChoice,
  Character,
  createPose,
  FitCamera,
  meshBounds,
  Placement,
  type PlacementMode,
  type Pose,
  type SceneClock,
  sequencePose,
  snappedPose,
  useAssetTextures,
  useBackdropFlags,
  useBackdropMaps,
  useSceneColors,
  Viewport,
  viewportQueries,
} from "@/modules/viewport";
import {
  type PreviewDisplay,
  usePreviewAmbientOcclusion,
  usePreviewAntiAliasing,
  usePreviewArmature,
  usePreviewBackdrop,
  usePreviewBackdropParticles,
  usePreviewBackdropSky,
  usePreviewBackdropStructures,
  usePreviewCamera,
  usePreviewFacing,
  usePreviewGround,
  usePreviewJointNames,
  usePreviewMidlane,
  usePreviewMove,
  usePreviewMoveMode,
  usePreviewPlacedOn,
  usePreviewPlacement,
  usePreviewPostEffects,
  usePreviewShaders,
  usePreviewSun,
  usePreviewViewMode,
  usePreviewWireOverlay,
  useSetPreviewDisplay,
} from "@/stores";

import { assetKey, assetProject } from "../../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { BackdropLayerMenu } from "../../map/components/BackdropLayerMenu";
import { MapCharacters } from "../../map/components/MapCharacters";
import { MapParticles } from "../../map/components/MapParticles";
import { PostEffectsControl } from "../../map/components/PostEffectsControl";
import { SunControl } from "../../map/components/SunControl";
import { useMapMaterialsFile, useMapParticles } from "../../map/hooks/useMapParticles";
import { useHeldValue } from "../../material/state/heldValue";
import { vfxQueries } from "../../vfx/hooks/useVfxSystem";
import { CameraMenu } from "../../vfx/preview/components/CameraMenu";
import { Notice } from "../../vfx/preview/components/Notice";
import { ViewModeMenu } from "../../vfx/preview/components/ViewModeMenu";
import { ViewToggle } from "../../vfx/preview/components/ViewToggle";
import { Passes } from "../../vfx/rendering/components/Passes";
import { passesOf } from "../../vfx/rendering/utils/passes";
import { skinQueries } from "../api/skinQueries";
import { DocumentOpener, type GraphSource, useSkinGraphSource } from "../hooks/useGraphSource";
import { useSkinKeys } from "../hooks/useSkinKeys";
import { useSkinPrograms } from "../hooks/useSkinPrograms";
import { overriddenHidden, SkinChoiceContext, useSkinChoice } from "../state/skinChoice";
import {
  clipFrameSeconds,
  hiddenAt,
  particleCues,
  snapCues,
  timedSteps,
  type VisibilityEntry,
  visibilityTimeline,
} from "../utils/clipEvents";
import { foldedTime } from "../utils/follow";
import {
  BIND_POSE,
  bindingOf,
  jointSlot,
  nearestValue,
  openingClip,
  parameterValues,
  playableClips,
  playlistOf,
  systemModel,
  textureAssets,
} from "../utils/skinScene";
import { BakeTangentsButton } from "./BakeTangentsButton";
import { ClipEffect } from "./ClipEffect";
import { IdleEffect } from "./IdleEffect";
import { type PlayingStep, SkinTransport } from "./SkinTransport";

/** `useFrame` runs the lowest priority first, so the clock moves before anything samples it. */
const BEFORE_THE_SCENE = -1;

const NO_CLIPS: readonly GraphClip[] = [];

/** Where the character's feet stand, which the match camera stands off. */
const FEET = [0, 0, 0] as const;

export interface SkinViewportProps {
  readonly document: BinDocumentId;
  /** What the document was read from, which tells a graph another file declares apart. */
  readonly asset: AssetRef;
  /** The skin object, `0x` and eight hex digits. */
  readonly entry: string;
  /** The backend no longer holds `document`, so the tab reopens it. */
  readonly onNotOpen?: () => void;
}

/**
 * One skin on its skeleton, posed by a clip of its graph and wearing its idle effects.
 *
 * A graph the index says another file declares is read through a second handle, as the
 * idle effect table reads a foreign resolver. Every other graph is read through the
 * skin's own document, which looks in the files it links.
 */
export default function SkinViewport({ document, asset, entry, onNotOpen }: SkinViewportProps) {
  const { skin: read, source, opener } = useSkinGraphSource(document, asset, entry);
  /* The store evicts the least recently used asset at capacity, so a tab left in the
     background can hold an id that no longer reads. A reopen issues a fresh one. */
  const notOpen = read.error?.code === "BIN_NOT_OPEN";
  useEffect(() => {
    if (notOpen) onNotOpen?.();
  }, [notOpen, onNotOpen]);

  if (notOpen) return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  if (read.error !== null) return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  if (read.data === undefined) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }

  /* The scene stays mounted while the graph's declaration answers, so the canvas and the
     textures it holds are not built twice. */
  return (
    <>
      {opener}
      <SkinScene skin={read.data} document={document} asset={asset} source={source} entry={entry} />
    </>
  );
}

interface SkinSceneProps {
  readonly entry: string;
  readonly skin: SkinModel;
  /** The skin's own document, which declares the systems its idle effects name. */
  readonly document: BinDocumentId;
  /** What the document was read from, whose project answers a map's files first. */
  readonly asset: AssetRef;
  /** Where the skin's animation graph is read from. */
  readonly source: GraphSource;
}

function SkinScene({ skin, document, asset, source, entry }: SkinSceneProps) {
  const own = useSkinChoice();
  const { clock, picked, setPicked, playing, setPlaying, speed, setSpeed } =
    use(SkinChoiceContext) ?? own;
  const { effects, setEffects, submesh, pickSubmesh, mask } = use(SkinChoiceContext) ?? own;
  const { parameter, setParameter, shown, setShown, resetShown } = use(SkinChoiceContext) ?? own;

  const ground = usePreviewGround();
  const backdrop = usePreviewBackdrop();
  /* The skin's own document stands for its project, whose layer answers before the
     install for a map the creator has replaced. */
  const shaders = usePreviewShaders();
  /* A document answers from its own file's project, as `LayerChunks::of` reads it. */
  const openIn = useOptionalProjectContext()?.path ?? null;
  const project = assetProject(asset, openIn);
  const backdropSource = useMemo(
    () => (backdrop === null ? null : { map: backdrop, document, project, shaders }),
    [backdrop, document, project, shaders],
  );
  const backdropParticles = usePreviewBackdropParticles();
  const backdropStructures = usePreviewBackdropStructures();
  const backdropSky = usePreviewBackdropSky();
  const {
    layers: backdropLayers,
    flags: backdropFlags,
    setLayer: setBackdropLayer,
  } = useBackdropFlags(backdropSource);
  const midlane = usePreviewMidlane();
  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const viewMode = usePreviewViewMode();
  const wireOverlay = usePreviewWireOverlay();
  const armature = usePreviewArmature();
  const jointNames = usePreviewJointNames();
  const move = usePreviewMove();
  const moveMode = usePreviewMoveMode();
  const placement = usePreviewPlacement();
  const placedOn = usePreviewPlacedOn();
  const facing = usePreviewFacing();
  const sun = usePreviewSun();
  const postEffects = usePreviewPostEffects();
  const ambientOcclusion = usePreviewAmbientOcclusion();
  const [origin, setOrigin] = useState<readonly [number, number, number] | null>(null);
  const [controlsHidden, setControlsHidden] = useState(false);
  const setDisplay = useSetPreviewDisplay();

  useEffect(() => {
    if (!controlsHidden) return;

    const showControls = (event: KeyboardEvent) => {
      if (event.key === "Escape") setControlsHidden(false);
    };
    window.addEventListener("keydown", showControls);

    return () => window.removeEventListener("keydown", showControls);
  }, [controlsHidden]);

  const mesh = useQuery(viewportQueries.mesh(skin.mesh?.asset ?? null));
  const skeleton = useQuery(viewportQueries.skeleton(skin.skeleton?.asset ?? null));
  const graph = useQuery(skinQueries.graph(source.document, source.graph));
  const listed = useMemo(
    () => (graph.data === undefined ? NO_CLIPS : playableClips(graph.data.clips)),
    [graph.data],
  );

  const held = picked === BIND_POSE || listed.some((clip) => clip.hash === picked) ? picked : null;
  const chosen = held ?? openingClip(listed)?.hash ?? BIND_POSE;
  const chosenClip = listed.find((each) => each.hash === chosen) ?? null;
  const values = useMemo(
    () => (chosenClip === null ? null : parameterValues(chosenClip)),
    [chosenClip],
  );
  /* A parametric clip plays at the pair value nearest what the reader set, and at its
     first pair's value before they set one. */
  const at = useMemo(() => {
    if (values === null) return null;
    return nearestValue(values, parameter ?? chosenClip?.parameters[0] ?? values[0]);
  }, [values, chosenClip, parameter]);
  /* The atomic clips the chosen one plays, in order: itself, or what a composite reaches. */
  const playlist = useMemo(() => {
    if (chosenClip === null || graph.data === undefined) return NO_CLIPS;
    return playlistOf(chosenClip, graph.data.clips, at);
  }, [chosenClip, graph.data, at]);
  const clipModels = useQueries({
    queries: playlist.map((step) => viewportQueries.clip(step.animation?.asset ?? null)),
    combine: (results) => results.map((result) => result.data ?? null),
  });
  const stepPoses = useMemo(() => {
    const bones = skeleton.data;
    if (bones === undefined) return [];
    return clipModels.map((model, at) =>
      createPose(bones, model, clipFrameSeconds(playlist[at], model?.fps ?? null)),
    );
  }, [skeleton.data, clipModels, playlist]);
  const sequenced = useMemo(
    () => (skeleton.data === undefined ? null : sequencePose(skeleton.data, stepPoses)),
    [skeleton.data, stepPoses],
  );
  /* The clip's events, placed on the pass: what they hide and show, what they spawn, and
     which joints they stand on others. */
  const timed = useMemo(
    () =>
      timedSteps(
        playlist,
        stepPoses.map((step) => step.duration),
        clipModels.map((model) => model?.fps ?? null),
      ),
    [playlist, stepPoses, clipModels],
  );
  const pose = useMemo(() => {
    if (sequenced === null) return null;
    const snaps = snapCues(timed).map((cue) => ({
      ...cue,
      joint: jointSlot(sequenced, cue.joint),
      snapTo: jointSlot(sequenced, cue.snapTo),
    }));
    return snappedPose(sequenced, snaps);
  }, [sequenced, timed]);
  const duration = pose?.duration ?? 0;
  const steps = useMemo<PlayingStep[]>(
    () =>
      playlist.map((step, at) => ({
        hash: step.hash,
        name: step.name,
        duration: stepPoses[at]?.duration ?? 0,
      })),
    [playlist, stepPoses],
  );
  const maskWeights = useMemo(() => {
    const weights = graph.data?.masks.find((each) => each.hash === mask)?.weights;
    return weights === undefined ? null : Float32Array.from(weights, (weight) => weight ?? 0);
  }, [graph.data, mask]);

  const submeshes = useMemo(() => mesh.data?.ranges.map((range) => range.name) ?? [], [mesh.data]);
  const timeline = useMemo(
    () => visibilityTimeline(skin.hidden, submeshes, timed),
    [skin.hidden, submeshes, timed],
  );
  const [cued, setHidden] = useState<readonly string[]>(skin.hidden);
  const hidden = useMemo(() => overriddenHidden(cued, shown), [cued, shown]);
  /* The names are painted on a canvas over the scene, mounted here where the DOM is. */
  const [labels, setLabels] = useState<HTMLCanvasElement | null>(null);
  const cues = useMemo(() => particleCues(timed, skin.effectSystems), [timed, skin.effectSystems]);
  /* A system a linked file declares is read through a handle on that file, held open
     beside the skin's own document as a foreign graph is. */
  const sources = useMemo(() => {
    const seen = new Map<string, AssetRef>();
    for (const cue of cues) if (cue.source !== null) seen.set(assetKey(cue.source), cue.source);
    return [...seen.entries()];
  }, [cues]);
  const [opened, setOpened] = useState<ReadonlyMap<string, BinDocumentId>>(() => new Map());
  const openSource = useCallback((id: string, handle: BinDocumentId | null) => {
    setOpened((held) => {
      const next = new Map(held);
      if (handle === null) next.delete(id);
      else next.set(id, handle);
      return next;
    });
  }, []);
  const cueModels = useQueries({
    queries: cues.map((cue) => {
      const handle = cue.source === null ? document : (opened.get(assetKey(cue.source)) ?? null);
      if (handle === null) return { ...vfxQueries.system(document, cue.system), enabled: false };
      return vfxQueries.system(handle, cue.system);
    }),
    combine: (results) =>
      results.map((result) => (result.data === undefined ? null : systemModel(result.data))),
  });

  const assets = useMemo(() => textureAssets(skin), [skin]);
  const textures = useAssetTextures(assets);
  const bindingFor = useCallback(
    (submesh: string) => bindingOf(skin, textures, submesh),
    [skin, textures],
  );
  const programFor = useSkinPrograms(document, skin, shaders);
  const heldValue = useHeldValue();
  const colors = useSceneColors();
  const scale = skin.scale ?? 1;
  /* Where the subject stands: what the creator dragged it to on this backdrop, else the
     backdrop's own middle, else the scene's origin. A placement made on another map is a
     point that map has and this one does not. */
  const pinned = placement !== null && placedOn === backdrop ? placement : null;
  const stood = useMemo<[number, number, number]>(
    () => [...(pinned ?? origin ?? FEET)],
    [pinned, origin],
  );
  /* One open file answers both what the map plays and what it stands. */
  const mapFile = useMapMaterialsFile(backdropParticles || backdropStructures ? backdrop : null);
  const mapParticles = useMapParticles(backdropParticles ? mapFile.document : null, backdropFlags);
  const bounds = useMemo(
    () => (mesh.data === undefined ? null : meshBounds(mesh.data, skin.hidden, scale)),
    [mesh.data, skin.hidden, scale],
  );
  /* Fit answers the F key and the button. A change of preset frames again on its own. */
  const [fitToken, setFitToken] = useState(0);
  const refit = useCallback(() => setFitToken((token) => token + 1), []);

  const keys = useSkinKeys({ clock, playing, setPlaying, speed, setSpeed, fit: refit });

  const idle = useMemo(
    () =>
      skin.idleEffects.flatMap((effect) =>
        effect.system === null ? [] : [{ effect, system: effect.system }],
      ),
    [skin],
  );
  const systems = useQueries({
    queries: idle.map(({ system }) => vfxQueries.system(document, system)),
  });
  const models = systems.map((query) =>
    query.data === undefined ? null : systemModel(query.data),
  );
  const worn = [...models, ...cueModels];
  const loaded = worn.map((model) => (model === null ? "-" : "+")).join("");
  /* The map's systems play whatever the skin's own switch says, and stay out of `loaded`,
     whose change is a seek of every effect the skin wears. */
  const played = [...(effects ? worn : []), ...mapParticles.map((group) => group.system)];
  const { warps, softens } = passesOf(played);

  /* A clip changing starts the pose and every idle effect over together, so an effect
     rides the clip from its first frame. The pose a preview mounts on keeps the time the
     clock stood at, which is what a change of frame asks of it. */
  const posed = useRef<Pose | null>(null);
  useEffect(() => {
    if (posed.current !== null && pose !== null && posed.current !== pose) clock.restart();
    posed.current = pose;
  }, [clock, pose]);

  /* An effect that joins replays to the clock's time, so the clock folds into one pass
     of the clip first, which draws the same frame of the pose. */
  useEffect(() => {
    const folded = foldedTime(clock.time, duration);
    if (folded !== clock.time) clock.seek(folded);
  }, [clock, duration, loaded, effects]);

  if (!skin.mesh?.asset || !skin.skeleton?.asset) {
    return <Notice text={m.workshop_bin_mesh_preview_missing_empty()} />;
  }
  if (mesh.error !== null || skeleton.error !== null) {
    return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  }
  if (mesh.data === undefined || pose === null) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }

  return (
    <>
      {sources.map(([id, asset]) => (
        <SourceOpener key={id} id={id} asset={asset} onOpen={openSource} />
      ))}
      {mapFile.source !== null && (
        /* Keyed, so a change of map lets the last map's handle go before the next answers. */
        <DocumentOpener
          key={assetKey(mapFile.source)}
          asset={mapFile.source}
          onOpen={mapFile.onOpen}
        />
      )}
      <div
        ref={keys}
        tabIndex={-1}
        data-ui="SkinViewport"
        className="relative min-h-0 flex-1 outline-none"
      >
        <Viewport
          antiAliasing={antiAliasing}
          renderer="shared"
          gizmo={!controlsHidden}
          stage={ground}
          textured={midlane}
          backdrop={backdropSource}
          backdropFlags={backdropFlags}
          backdropSky={backdropSky}
          sun={backdrop === null ? null : sun}
          postEffects={backdrop === null ? null : postEffects}
          ambientOcclusion={backdrop === null ? null : ambientOcclusion}
          camera={camera}
          viewMode={viewMode}
          wireOverlay={wireOverlay}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
          onBackdropOrigin={setOrigin}
        >
          <Clock clock={clock} playing={playing} speed={speed} />
          <VisibilityCues
            timeline={timeline}
            clock={clock}
            duration={duration}
            onChange={setHidden}
          />
          <FitCamera bounds={bounds} ground={stood} token={fitToken} />
          <Passes warps={warps} softens={softens} />
          <MapParticles groups={mapParticles} />
          {backdropStructures && (
            <MapCharacters document={mapFile.document} near={asset} flags={backdropFlags} />
          )}
          <Placement
            enabled={move && !controlsHidden}
            mode={moveMode}
            position={stood}
            facing={facing}
            onMove={(placed) =>
              setDisplay({
                previewPlacement: [...placed.position],
                previewPlacedOn: backdrop,
                previewFacing: placed.facing,
              })
            }
          >
            <Character
              mesh={mesh.data}
              pose={pose}
              clock={clock}
              bindingOf={bindingFor}
              programOf={programFor}
              held={heldValue}
              colors={colors}
              hidden={hidden}
              scale={scale}
              selfIllumination={skin.selfIllumination ?? 0}
              highlighted={submesh}
              jointWeights={maskWeights}
              onSubmeshPick={pickSubmesh}
            >
              {effects &&
                idle.map(({ effect }, at) => {
                  const system = models[at];
                  if (system === null) return null;
                  return (
                    <IdleEffect
                      key={`${at}:${effect.effectKey}`}
                      effect={effect}
                      system={system}
                      pose={pose}
                      clock={clock}
                      scale={scale}
                    />
                  );
                })}
              {effects &&
                cues.map((cue, at) => {
                  const system = cueModels[at];
                  if (system === null || system === undefined) return null;
                  return (
                    <ClipEffect
                      key={cue.key}
                      cue={cue}
                      system={system}
                      pose={pose}
                      clock={clock}
                      scale={scale}
                      duration={duration}
                    />
                  );
                })}
            </Character>
            {armature && (
              <Armature
                pose={pose}
                clock={clock}
                scale={scale}
                colors={colors}
                jointWeights={maskWeights}
                labels={jointNames ? labels : null}
              />
            )}
          </Placement>
        </Viewport>
        {!controlsHidden && armature && jointNames && (
          <canvas
            ref={setLabels}
            data-ui="SkinViewport:joint-names"
            aria-hidden
            className="pointer-events-none absolute inset-0 font-mono text-fine select-none"
          />
        )}

        {!controlsHidden && (
          <div
            data-ui="SkinViewport:controls"
            /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
            className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md border border-surface-veil bg-scrim p-1 shadow-md backdrop-blur-sm [&_button]:text-meta"
          >
            <div className="flex shrink-0 items-center gap-0.5">
              <BackdropToggle />
              {backdrop !== null && (
                <>
                  <BackdropLayerMenu
                    layers={backdropLayers}
                    flags={backdropFlags}
                    onLayerChange={setBackdropLayer}
                  />
                  <SunControl source={backdropSource} />
                  <PostEffectsControl source={backdropSource} />
                </>
              )}
            </div>
            <ViewportControlDivider />
            <div className="flex shrink-0 items-center gap-0.5">
              <PlacementToggle />
              {backdrop === null && (
                <ViewToggle
                  label={m.workshop_bin_preview_stage_label()}
                  active={ground}
                  icon={<GridFourIcon weight="bold" className="h-4 w-4" />}
                  onClick={() => setDisplay({ previewGround: !ground })}
                />
              )}
              {backdrop === null && ground && (
                <ViewToggle
                  label={m.workshop_bin_preview_midlane_label()}
                  active={midlane}
                  icon={<MapTrifoldIcon weight="bold" className="h-4 w-4" />}
                  onClick={() => setDisplay({ previewMidlane: !midlane })}
                />
              )}
            </div>
            <ViewportControlDivider />
            <div className="flex shrink-0 items-center gap-0.5">
              {(idle.length > 0 || cues.length > 0) && (
                <ViewToggle
                  label={m.workshop_bin_mesh_preview_effects_label()}
                  active={effects}
                  icon={<SparkleIcon weight="bold" className="h-4 w-4" />}
                  onClick={() => setEffects(!effects)}
                />
              )}
              <ArmatureMenu />
              <ViewToggle
                label={m.workshop_bin_preview_shaders_label()}
                active={shaders}
                icon={<HexshadeIcon className={shaders ? "h-4 w-4" : "h-4 w-4 grayscale"} />}
                onClick={() => setDisplay({ previewShaders: !shaders })}
              />
              <BakeTangentsButton
                document={document}
                entry={entry}
                asset={asset}
                mesh={skin.mesh?.asset ?? null}
              />
              <SubmeshMenu
                submeshes={submeshes}
                hidden={hidden}
                overridden={shown.size > 0}
                onShow={setShown}
                onReset={resetShown}
              />
            </div>
            <ViewportControlDivider />
            <div className="flex shrink-0 items-center gap-0.5">
              <ViewModeMenu />
              <CameraMenu />
              <Tooltip content={m.workshop_bin_mesh_preview_fit_action()}>
                <IconButton
                  variant="ghost"
                  size="xs"
                  compact
                  aria-label={m.workshop_bin_mesh_preview_fit_action()}
                  icon={<FrameCornersIcon weight="bold" className="h-4 w-4" />}
                  onClick={refit}
                />
              </Tooltip>
            </div>
            <ViewportControlDivider />
            <Tooltip content={m.workshop_bin_preview_hide_ui_hint()}>
              <IconButton
                variant="ghost"
                size="xs"
                compact
                aria-label={m.workshop_bin_preview_hide_ui_action()}
                icon={<EyeSlashIcon weight="bold" className="h-4 w-4" />}
                onClick={() => setControlsHidden(true)}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {!controlsHidden && (
        <SkinTransport
          clock={clock}
          duration={duration}
          playing={playing}
          speed={speed}
          clips={listed}
          clip={chosen}
          steps={steps}
          parameter={values === null || at === null ? null : { values, value: at }}
          onParameterChange={setParameter}
          onPlayingChange={setPlaying}
          onSpeedChange={setSpeed}
          onClipChange={setPicked}
        />
      )}
    </>
  );
}

function ViewportControlDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-surface-veil" />;
}

/**
 * What a map's row reads, where the game's own name for it is one this app can state.
 *
 * The index spells a map by its directory, `map11`, and that directory is all that says
 * which map it is. Only the two everyone names are named, and every other map reads as
 * its own directory rather than as a guess.
 */
const MAP_NAMES: Record<string, () => string> = {
  map11: m.workshop_bin_preview_backdrop_map11_label,
  map12: m.workshop_bin_preview_backdrop_map12_label,
};

/** One map of the install and every skin of it the install ships geometry for. */
interface MapGroup {
  readonly folder: string;
  readonly name: string;
  readonly skins: readonly BackdropChoice[];
}

function groupMaps(choices: readonly BackdropChoice[]): MapGroup[] {
  const groups = new Map<string, BackdropChoice[]>();
  for (const choice of choices) {
    const held = groups.get(choice.folder);
    if (held === undefined) groups.set(choice.folder, [choice]);
    else held.push(choice);
  }
  return [...groups].map(([folder, skins]) => ({
    folder,
    name: MAP_NAMES[folder]?.() ?? folder.charAt(0).toUpperCase() + folder.slice(1),
    skins,
  }));
}

/** The map behind the subject as a switch with its choices attached. */
function BackdropToggle() {
  const backdrop = usePreviewBackdrop();
  const particles = usePreviewBackdropParticles();
  const structures = usePreviewBackdropStructures();
  const sky = usePreviewBackdropSky();
  const setDisplay = useSetPreviewDisplay();
  const maps = useBackdropMaps();
  /* Turning the backdrop off drops which map it drew, so the switch hands the same map
     back rather than returning to the first one in the install. */
  const last = useRef<MapPath | null>(null);
  if (backdrop !== null) last.current = backdrop;

  const choices = maps.data ?? [];
  const groups = useMemo(() => groupMaps(maps.data ?? []), [maps.data]);
  const opening = last.current ?? choices[0]?.map ?? null;
  const pick = (map: unknown) => setDisplay({ previewBackdrop: map as MapPath | null });

  return (
    <ButtonGroup className="overflow-hidden rounded-md bg-surface-veil">
      <ViewToggle
        label={m.workshop_bin_preview_backdrop_label()}
        active={backdrop !== null}
        icon={<MountainsIcon weight="bold" className="h-4 w-4" />}
        onClick={() => setDisplay({ previewBackdrop: backdrop === null ? opening : null })}
      />
      <Menu.Root>
        <Tooltip content={m.workshop_bin_preview_backdrop_menu_label()}>
          <Menu.Trigger
            render={
              <IconButton
                variant="ghost"
                size="xs"
                compact
                className="w-5 text-surface-400"
                aria-label={m.workshop_bin_preview_backdrop_menu_label()}
                icon={<CaretDownIcon weight="bold" className="h-3 w-3" />}
              />
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner align="end">
            <Menu.Popup data-ui="BackdropMenu" className="w-52">
              {choices.length === 0 && (
                <Menu.Item disabled>{m.workshop_bin_preview_backdrop_empty_label()}</Menu.Item>
              )}
              <Menu.RadioGroup value={backdrop} onValueChange={pick}>
                <Menu.RadioItem value={null}>
                  {m.workshop_bin_preview_backdrop_none_label()}
                </Menu.RadioItem>
              </Menu.RadioGroup>
              {groups.map((group) => (
                <MapSkinSubmenu key={group.folder} group={group} chosen={backdrop} onPick={pick} />
              ))}
              <Menu.Separator />
              <Menu.CheckboxItem
                checked={particles}
                onCheckedChange={(checked) => setDisplay({ previewBackdropParticles: checked })}
              >
                {m.workshop_bin_preview_backdrop_particles_label()}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem
                checked={structures}
                onCheckedChange={(checked) => setDisplay({ previewBackdropStructures: checked })}
              >
                {m.workshop_bin_preview_backdrop_structures_label()}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem
                checked={sky}
                onCheckedChange={(checked) => setDisplay({ previewBackdropSky: checked })}
              >
                {m.workshop_bin_preview_backdrop_sky_label()}
              </Menu.CheckboxItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}

/** The next state of the placement switch, which cycles off, move, turn. */
function nextPlacement(move: boolean, mode: PlacementMode): Partial<PreviewDisplay> {
  if (!move) return { previewMove: true, previewMoveMode: "translate" };
  if (mode === "translate") return { previewMoveMode: "rotate" };
  return { previewMove: false };
}

/** The placement gizmo as a switch with its options attached. */
function PlacementToggle() {
  const move = usePreviewMove();
  const mode = usePreviewMoveMode();
  const setDisplay = useSetPreviewDisplay();
  const turning = move && mode === "rotate";

  return (
    <ButtonGroup className="overflow-hidden rounded-md bg-surface-veil">
      <ViewToggle
        label={
          turning ? m.workshop_bin_preview_move_rotate_label() : m.workshop_bin_preview_move_label()
        }
        active={move}
        icon={
          turning ? (
            <ArrowsClockwiseIcon weight="bold" className="h-4 w-4" />
          ) : (
            <ArrowsOutCardinalIcon weight="bold" className="h-4 w-4" />
          )
        }
        /* One button cycles off, move, turn because the mode changes more often than the
           reset action in the attached menu. */
        onClick={() => setDisplay(nextPlacement(move, mode))}
      />
      <Menu.Root>
        <Tooltip content={m.workshop_bin_preview_move_menu_label()}>
          <Menu.Trigger
            render={
              <IconButton
                variant="ghost"
                size="xs"
                compact
                className="w-5 text-surface-400"
                aria-label={m.workshop_bin_preview_move_menu_label()}
                icon={<CaretDownIcon weight="bold" className="h-3 w-3" />}
              />
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner align="end">
            <Menu.Popup data-ui="PlacementMenu" className="w-44">
              <Menu.RadioGroup
                value={mode}
                onValueChange={(picked) =>
                  setDisplay({ previewMove: true, previewMoveMode: picked as PlacementMode })
                }
              >
                <Menu.RadioItem value="translate">
                  {m.workshop_bin_preview_move_translate_label()}
                </Menu.RadioItem>
                <Menu.RadioItem value="rotate">
                  {m.workshop_bin_preview_move_rotate_label()}
                </Menu.RadioItem>
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Item
                onClick={() =>
                  setDisplay({ previewPlacement: null, previewPlacedOn: null, previewFacing: 0 })
                }
              >
                {m.workshop_bin_preview_move_reset_action()}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}

interface MapSkinSubmenuProps {
  readonly group: MapGroup;
  /** Which map skin the backdrop draws, across every map rather than this one. */
  readonly chosen: MapPath | null;
  readonly onPick: (map: unknown) => void;
}

/**
 * One map of the install, with its skins behind it.
 *
 * A map ships one geometry file per skin, so the skins are what the map's directory
 * holds and the file's own name is what the skin is called.
 */
function MapSkinSubmenu({ group, chosen, onPick }: MapSkinSubmenuProps) {
  const holds = group.skins.some((skin) => skin.map === chosen);

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={holds ? "text-accent-300" : undefined}>
        {group.name}
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.SubmenuPositioner>
          {/* A map ships up to 37 skins, more than a menu shows without scrolling. */}
          <Menu.Popup data-ui="BackdropMenu:skins" className="max-h-96 w-56 overflow-y-auto">
            <Menu.RadioGroup value={chosen} onValueChange={onPick}>
              {group.skins.map((skin) => (
                <Menu.RadioItem key={skin.map} value={skin.map} closeOnClick>
                  {skin.geometry}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.SubmenuPositioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** The armature switch and its drawing options as one split control. */
function ArmatureMenu() {
  const armature = usePreviewArmature();
  const jointNames = usePreviewJointNames();
  const setDisplay = useSetPreviewDisplay();

  return (
    <ButtonGroup className="overflow-hidden rounded-md bg-surface-veil">
      <ViewToggle
        label={m.workshop_bin_preview_armature_label()}
        active={armature}
        icon={<BoneIcon weight="bold" className="h-4 w-4" />}
        onClick={() => setDisplay({ previewArmature: !armature })}
      />
      <Menu.Root>
        <Tooltip content={m.workshop_bin_preview_armature_menu_label()}>
          <Menu.Trigger
            render={
              <IconButton
                variant="ghost"
                size="xs"
                compact
                className="w-5 text-surface-400"
                aria-label={m.workshop_bin_preview_armature_menu_label()}
                icon={<CaretDownIcon weight="bold" className="h-3 w-3" />}
              />
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner align="end">
            <Menu.Popup data-ui="ArmatureMenu" className="w-44">
              <Menu.CheckboxItem
                checked={armature && jointNames}
                disabled={!armature}
                onCheckedChange={(checked) => setDisplay({ previewJointNames: checked })}
              >
                {m.workshop_bin_preview_joint_names_label()}
              </Menu.CheckboxItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}

interface SourceOpenerProps {
  /** What the owner keys the handle under. */
  readonly id: string;
  readonly asset: AssetRef;
  readonly onOpen: (id: string, handle: BinDocumentId | null) => void;
}

/** One linked file a cue's system lives in, held open and reported under its key. */
function SourceOpener({ id, asset, onOpen }: SourceOpenerProps) {
  const report = useCallback((handle: BinDocumentId | null) => onOpen(id, handle), [id, onOpen]);
  return <DocumentOpener asset={asset} onOpen={report} />;
}

interface SubmeshMenuProps {
  /** The `.skn`'s submeshes in its order. */
  readonly submeshes: readonly string[];
  /** The submeshes hidden right now, by the skin, the clip and the reader together. */
  readonly hidden: readonly string[];
  /** The reader has shown or hidden one by hand. */
  readonly overridden: boolean;
  readonly onShow: (submesh: string, shown: boolean) => void;
  readonly onReset: () => void;
}

/**
 * Each submesh of the mesh as a tick, which shows or hides it by hand over what the skin
 * and the clip's events say, and a row that lets them all go again.
 */
function SubmeshMenu({ submeshes, hidden, overridden, onShow, onReset }: SubmeshMenuProps) {
  const skipped = new Set(hidden.map((name) => name.toLowerCase()));
  return (
    <Menu.Root>
      <Tooltip content={m.workshop_bin_preview_submeshes_label()}>
        <Menu.Trigger
          render={
            <IconButton
              variant="ghost"
              size="xs"
              compact
              aria-label={m.workshop_bin_preview_submeshes_label()}
              /* DS-VEIL, DS-RADIUS */
              className={
                overridden ? "bg-accent-500/15 text-accent-300 hover:bg-accent-500/25" : undefined
              }
              icon={<StackIcon weight="bold" className="h-4 w-4" />}
            />
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup data-ui="SubmeshMenu" className="max-h-80 w-56 overflow-y-auto scrollbar-md">
            {submeshes.map((name) => (
              <Menu.CheckboxItem
                key={name}
                closeOnClick={false}
                checked={!skipped.has(name.toLowerCase())}
                onCheckedChange={(checked) => onShow(name, checked)}
              >
                <span className="truncate font-mono text-code select-text">{name}</span>
              </Menu.CheckboxItem>
            ))}
            {overridden && (
              <>
                <Menu.Separator />
                <Menu.Item onClick={onReset}>
                  {m.workshop_bin_preview_submeshes_reset_action()}
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The scene's clock, spending each frame's time before the scene is sampled. */
function Clock({ clock, playing, speed }: { clock: SceneClock; playing: boolean; speed: number }) {
  useFrame((_, delta) => {
    if (playing) clock.advance(delta * speed);
  }, BEFORE_THE_SCENE);
  return null;
}

interface VisibilityCuesProps {
  readonly timeline: readonly VisibilityEntry[];
  readonly clock: SceneClock;
  /** Seconds one pass of the pose lasts, which the timeline is read over. */
  readonly duration: number;
  /** The submeshes hidden from this frame on, called on the frames that change them alone. */
  readonly onChange: (hidden: readonly string[]) => void;
}

/**
 * The submesh visibility events of the playing clip, applied as the clock reaches them.
 *
 * Each entry of the timeline is one array, so the character rebinds on the few frames
 * an event falls on and on none of the rest.
 */
function VisibilityCues({ timeline, clock, duration, onChange }: VisibilityCuesProps) {
  const last = useRef<readonly string[] | null>(null);
  useFrame(() => {
    const now = hiddenAt(timeline, foldedTime(clock.time, duration));
    if (now === last.current) return;
    last.current = now;
    onChange(now);
  }, BEFORE_THE_SCENE);
  return null;
}
