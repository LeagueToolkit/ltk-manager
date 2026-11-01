import {
  ArrowsClockwiseIcon,
  ArrowsOutCardinalIcon,
  BoneIcon,
  EyeSlashIcon,
  GridFourIcon,
  MapTrifoldIcon,
  MountainsIcon,
  SparkleIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useFrame } from "@react-three/fiber";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { type RefObject, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";

import { IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, GraphClip, MapPath, SkinModel } from "@/lib/tauri";
import {
  Armature,
  type BackdropChoice,
  type CaptureFrame,
  Character,
  createPose,
  FitCamera,
  JointHighlight,
  LiveRoot,
  meshBounds,
  Placement,
  type PlacementMode,
  type Pose,
  type SceneClock,
  sequencePose,
  SIMULATED_RATES,
  snappedPose,
  SocketGizmo,
  useAssetTextures,
  useBackdropFlags,
  useBackdropMaps,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";
import {
  type PreviewDisplay,
  usePreviewAmbientOcclusion,
  usePreviewArmature,
  usePreviewBackdrop,
  usePreviewBackdropEvents,
  usePreviewBackdropParticles,
  usePreviewBackdropSky,
  usePreviewBackdropStructures,
  usePreviewBackground,
  usePreviewFacing,
  usePreviewGround,
  usePreviewJointNames,
  usePreviewMidlane,
  usePreviewMove,
  usePreviewMoveMode,
  usePreviewPlacedOn,
  usePreviewOutlines,
  usePreviewPhysics,
  usePreviewPlacement,
  usePreviewPostEffects,
  usePreviewShaders,
  usePreviewSun,
  useSetPreviewDisplay,
} from "@/stores";

import { useViewportSound } from "../../../audio/hooks/useViewportSound";
import { assetKey } from "../../../preview/utils/assetRef";
import { useSandbox } from "../../../sandbox/state/SandboxContext";
import { sandboxProject } from "../../../sandbox/utils/sandboxRef";
import { BackdropVisibilityControl } from "../../map/components/BackdropVisibilityControl";
import { MapCharacters } from "../../map/components/MapCharacters";
import { MapParticles } from "../../map/components/MapParticles";
import { PostEffectsControl } from "../../map/components/PostEffectsControl";
import { SunControl } from "../../map/components/SunControl";
import { useMapMaterialsFile, useMapParticles } from "../../map/hooks/useMapParticles";
import { useHeldValue } from "../../material/state/heldValue";
import { usePaneCommands } from "../../menus/state/paneCommands";
import { BackgroundControl } from "../../shared/preview/BackgroundControl";
import { CameraMenu } from "../../shared/preview/CameraMenu";
import { CaptureButton } from "../../shared/preview/CaptureButton";
import { Notice } from "../../shared/preview/Notice";
import { PreviewToggle, ShadersToggle } from "../../shared/preview/PreviewToggle";
import { PreviewViewport } from "../../shared/preview/PreviewViewport";
import { SoundCues } from "../../shared/preview/SoundCues";
import { SoundToggle } from "../../shared/preview/SoundToggle";
import { useFitRequest } from "../../shared/preview/useFitRequest";
import { ViewModeMenu } from "../../shared/preview/ViewModeMenu";
import {
  ControlDivider,
  FitButton,
  SplitToggle,
  ViewportControls,
} from "../../shared/preview/ViewportControls";
import { runSoundCues } from "../../vfx/playback/utils/runSound";
import { Passes } from "../../vfx/rendering/components/Passes";
import { passesOf } from "../../vfx/rendering/utils/passes";
import { skinQueries } from "../api/skinQueries";
import { useBakeTangents } from "../hooks/useBakeTangents";
import { useDynamicsEdit } from "../hooks/useDynamicsEdit";
import { DocumentOpener, type GraphSource, useSkinGraphSource } from "../hooks/useGraphSource";
import { useJointPick } from "../hooks/useJointPick";
import { useResetOnChange } from "../hooks/useResetOnChange";
import { useSkinDynamics } from "../hooks/useSkinDynamics";
import { useSkinKeys } from "../hooks/useSkinKeys";
import { useSkinOutlines } from "../hooks/useSkinOutlines";
import { useSkinPrograms } from "../hooks/useSkinPrograms";
import { useWornEffects } from "../hooks/useWornEffects";
import { overriddenHidden, SkinChoiceContext, useSkinChoice } from "../state/skinChoice";
import {
  clipFrameSeconds,
  hiddenAt,
  snapCues,
  soundCues,
  timedSteps,
  type VisibilityEntry,
  visibilityTimeline,
} from "../utils/clipEvents";
import { conditionedHidden } from "../utils/conditionScene";
import { foldedTime } from "../utils/follow";
import {
  listCommands,
  SKIN_BAKE_COMMAND,
  SKIN_EFFECTS_COMMAND,
  SKIN_FIT_COMMAND,
  SKIN_HIDE_UI_COMMAND,
  SKIN_OUTLINE_COMMAND,
  SKIN_OVERLAY_COMMAND,
  SKIN_PARAMETER_LIST,
  SKIN_POST_EFFECTS_COMMAND,
  SKIN_RATE_LIST,
  SKIN_SCRUB_COMMAND,
  SKIN_SUBMESH_LIST,
  SKIN_SUN_COMMAND,
  SKIN_VISIBILITY_COMMAND,
} from "../utils/skinCommands";
import { SKIN_SHOW_UI_KEY } from "../utils/skinKeys";
import {
  BIND_POSE,
  bindingOf,
  chosenClipHash,
  jointSlot,
  nearestValue,
  parameterValues,
  parameterLabel,
  playableClips,
  playlistOf,
  DATA_TEXTURES,
  dataTextureAssets,
  HELD_TEXTURES,
  textureAssets,
} from "../utils/skinScene";
import { socketDragEdits } from "../utils/socketEdits";
import { BakeTangentsButton } from "./BakeTangentsButton";
import { ClipEffect } from "./ClipEffect";
import { BEFORE_THE_SCENE, Clock } from "./Clock";
import { JointEffect } from "./JointEffect";
import { PhysicsMenu } from "./PhysicsMenu";
import { SkinEffectCommands, SkinEffectsMenu } from "./SkinEffectsMenu";
import { SkinPhysicsOverlay } from "./SkinPhysicsOverlay";
import { type PlayingStep, SkinTransport } from "./SkinTransport";
import { SocketGizmoMode } from "./SocketGizmoMode";

const NO_CLIPS: readonly GraphClip[] = [];

/** Where the character's feet stand, which the match camera stands off. */
const FEET = [0, 0, 0] as const;

/** Presses the control in `slot`, because the popup keeps its open state inside the control. */
function pressControl(slot: RefObject<HTMLElement | null>): void {
  slot.current?.querySelector("button")?.click();
}

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
 */
export default function SkinViewport({ document, asset, entry, onNotOpen }: SkinViewportProps) {
  const { skin: read, source } = useSkinGraphSource(document, entry);
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

  return (
    <SkinScene skin={read.data} document={document} asset={asset} source={source} entry={entry} />
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
  const { conditions, resetConditions } = use(SkinChoiceContext) ?? own;
  const { parameter, setParameter, shown, setShown, resetShown } = use(SkinChoiceContext) ?? own;
  const { simulatedRate, setSimulatedRate, muted, resetMuted } = use(SkinChoiceContext) ?? own;
  useResetOnChange(skin.persistentConditions.length, resetConditions);
  useResetOnChange(skin.poseModifiers.length, resetMuted);
  const { joint, setJoint, socket: movedSocket, socketMode } = use(SkinChoiceContext) ?? own;
  const { setSocketMode, socketSpace, setSocketSpace } = use(SkinChoiceContext) ?? own;

  const ground = usePreviewGround();
  const backdrop = usePreviewBackdrop();
  /* The skin's own document stands for its project, whose layer answers before the
     install for a map the creator has replaced. */
  const shaders = usePreviewShaders();
  const sandbox = useSandbox();
  const backdropSource = useMemo(() => {
    if (backdrop === null) return null;

    /* A layer subset shares no read with the whole project, so its document answers. */
    if (sandbox.kind === "layers") return { map: backdrop, document, sandbox, shaders };

    return { map: backdrop, document, project: sandboxProject(sandbox), shaders };
  }, [backdrop, document, sandbox, shaders]);
  const backdropParticles = usePreviewBackdropParticles();
  const backdropStructures = usePreviewBackdropStructures();
  const backdropSky = usePreviewBackdropSky();
  const background = usePreviewBackground();
  const capture = useRef<CaptureFrame | null>(null);
  const backdropFlags = useBackdropFlags(backdropSource);
  const backdropVisibility = backdropFlags.visibility;
  const midlane = usePreviewMidlane();
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
  const [scrubbing, setScrubbing] = useState(false);
  const setDisplay = useSetPreviewDisplay();

  useEffect(() => {
    if (!controlsHidden) return;

    const showControls = (event: KeyboardEvent) => {
      if (event.key === SKIN_SHOW_UI_KEY.key) setControlsHidden(false);
    };
    window.addEventListener("keydown", showControls);

    return () => window.removeEventListener("keydown", showControls);
  }, [controlsHidden]);

  /* A change of chosen layers can swap either file, and the old one draws until the new lands. */
  const mesh = useQuery({
    ...viewportQueries.mesh(skin.mesh?.asset ?? null),
    placeholderData: keepPreviousData,
  });
  const skeleton = useQuery({
    ...viewportQueries.skeleton(skin.skeleton?.asset ?? null),
    placeholderData: keepPreviousData,
  });
  const graph = useQuery(skinQueries.graph(source.document, source.graph));
  const listed = useMemo(
    () => (graph.data === undefined ? NO_CLIPS : playableClips(graph.data.clips)),
    [graph.data],
  );

  const chosen = chosenClipHash(listed, picked);
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
        chosenClip,
      ),
    [playlist, stepPoses, clipModels, chosenClip],
  );
  const clipPose = useMemo(() => {
    if (sequenced === null) return null;
    const snaps = snapCues(timed).map((cue) => ({
      ...cue,
      joint: jointSlot(sequenced, cue.joint),
      snapTo: jointSlot(sequenced, cue.snapTo),
    }));
    return snappedPose(sequenced, snaps);
  }, [sequenced, timed]);
  const scale = skin.scale ?? 1;
  /* While the Move gizmo is on, the reader moves the unit, and the pose is simulated live. */
  const dynamics = useSkinDynamics(skin, clipPose, {
    entry,
    timed,
    masks: graph.data?.masks,
    rate: simulatedRate,
    muted,
    live: move && !controlsHidden,
    socket: movedSocket,
    socketMode,
  });
  const { pose, handle } = dynamics;
  const driveLive = dynamics.drive;
  const sendDynamics = useDynamicsEdit(entry);
  /* An object under the placed group, which the socket's gizmo reads the unit's place from. */
  const unit = useRef<Group>(null);

  const jointCount = pose?.skeleton.joints.length ?? 0;
  const named = joint === null || pose === null ? -1 : pose.jointNamed(joint);
  const selectedJoint = named < jointCount ? named : -1;
  const picks = useJointPick(pose, selectedJoint, setJoint, pickSubmesh);
  const simulates = dynamics.rig !== null;
  const overlaid = simulates || skin.sockets.length > 0 || dynamics.shapes.length > 0;
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
  const hidden = useMemo(
    () =>
      overriddenHidden(
        conditionedHidden(cued, submeshes, skin.persistentConditions, conditions),
        shown,
      ),
    [cued, submeshes, skin.persistentConditions, conditions, shown],
  );
  /* The names are painted on a canvas over the scene, mounted here where the DOM is. */
  const [labels, setLabels] = useState<HTMLCanvasElement | null>(null);
  const { cues, cueModels, idle, drawn, drawnModels, worn, loaded } = useWornEffects(
    document,
    skin,
    timed,
    conditions,
  );
  const sounds = useMemo(() => soundCues(timed), [timed]);
  const heardSounds = useMemo(
    () => [
      ...sounds,
      ...cueModels.flatMap((system) => (system === null ? [] : runSoundCues(system))),
    ],
    [sounds, cueModels],
  );
  const sound = useViewportSound(document, heardSounds, playing && !scrubbing);

  const assets = useMemo(() => textureAssets(skin), [skin]);
  const textures = useAssetTextures(assets, HELD_TEXTURES);
  const dataAssets = useMemo(() => dataTextureAssets(skin), [skin]);
  const maps = useAssetTextures(dataAssets, DATA_TEXTURES);
  const bindingFor = useCallback(
    (submesh: string) => bindingOf(skin, textures, submesh, maps),
    [skin, textures, maps],
  );
  const programsFor = useSkinPrograms(document, skin, shaders, Boolean(mesh.data?.tangents));
  const outlineFor = useSkinOutlines(document, skin, shaders);
  const heldValue = useHeldValue();
  const colors = useSceneColors();
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
  const backdropEvents = usePreviewBackdropEvents();
  const mapParticles = useMapParticles(
    backdropParticles ? mapFile.document : null,
    backdropVisibility,
    { events: backdropEvents },
  );
  const bounds = useMemo(
    () => (mesh.data === undefined ? null : meshBounds(mesh.data, skin.hidden, scale)),
    [mesh.data, skin.hidden, scale],
  );
  /* Fit answers the F key and the button. A change of preset frames again on its own. */
  const [fitToken, refit] = useFitRequest();

  /* The viewport draws one gizmo, and `previewMove` says which: the unit's while it is on, else
     the picked socket's. Picking a socket hands the gizmo to the socket. */
  const socketEditable = handle !== null && sendDynamics !== null;
  const socketPath = socketEditable ? handle.path : null;
  useEffect(() => {
    if (socketPath !== null) setDisplay({ previewMove: false });
  }, [socketPath, setDisplay]);
  const socketGizmo = socketEditable && !move && !controlsHidden;
  const heldSocket = socketGizmo ? skin.sockets.find((each) => each.path === socketPath) : null;

  const keys = useSkinKeys({
    clock,
    playing,
    setPlaying,
    speed,
    setSpeed,
    fit: refit,
    socketGizmo: socketGizmo
      ? {
          move: () => setSocketMode("translate"),
          turn: () => setSocketMode("rotate"),
          toggleAxes: () => setSocketSpace(socketSpace === "local" ? "world" : "local"),
        }
      : null,
  });

  const bake = useBakeTangents({ document, entry, asset, mesh: skin.mesh?.asset ?? null });
  const physics = usePreviewPhysics();
  const outlines = usePreviewOutlines();
  const visibilitySlot = useRef<HTMLSpanElement>(null);
  const sunSlot = useRef<HTMLSpanElement>(null);
  const postEffectsSlot = useRef<HTMLSpanElement>(null);
  const transportBox = useRef<HTMLDivElement>(null);
  const rail = (slot: RefObject<HTMLElement | null>) => ({
    run: backdrop === null || controlsHidden ? null : () => pressControl(slot),
    reason: m.workshop_bin_menu_skin_backdrop_reason(),
  });
  const hiddenNames = new Set(hidden.map((name) => name.toLowerCase()));

  usePaneCommands("skin.viewport", {
    [SKIN_FIT_COMMAND]: { run: refit },
    [SKIN_HIDE_UI_COMMAND]: {
      run: () => setControlsHidden(!controlsHidden),
      checked: controlsHidden,
    },
    [SKIN_BAKE_COMMAND]: bake.offered
      ? {
          run: bake.available && !bake.pending ? bake.run : null,
          reason: bake.available ? undefined : m.workshop_bin_skin_tangents_layer_hint(),
          title: bake.pending ? m.workshop_bin_skin_tangents_pending_label() : undefined,
        }
      : undefined,
    [SKIN_SCRUB_COMMAND]: {
      run: controlsHidden
        ? null
        : () => transportBox.current?.querySelector<HTMLElement>('[role="slider"]')?.focus(),
      reason: m.workshop_bin_menu_skin_controls_reason(),
    },
    [SKIN_VISIBILITY_COMMAND]: rail(visibilitySlot),
    [SKIN_SUN_COMMAND]: rail(sunSlot),
    [SKIN_POST_EFFECTS_COMMAND]: rail(postEffectsSlot),
    [SKIN_EFFECTS_COMMAND]: {
      run: idle.length > 0 || cues.length > 0 ? () => setEffects(!effects) : null,
      checked: effects,
    },
    [SKIN_OUTLINE_COMMAND]: {
      run: skin.outlines.length > 0 ? () => setDisplay({ previewOutlines: !outlines }) : null,
      checked: outlines,
    },
    [SKIN_OVERLAY_COMMAND]: {
      run: overlaid ? () => setDisplay({ previewPhysics: !physics }) : null,
      checked: physics,
    },
    ...listCommands(
      SKIN_SUBMESH_LIST,
      submeshes.map((name) => {
        const visible = !hiddenNames.has(name.toLowerCase());

        return { title: name, checked: visible, run: () => setShown(name, !visible) };
      }),
    ),
    ...listCommands(
      SKIN_RATE_LIST,
      simulates
        ? SIMULATED_RATES.map((rate) => ({
            title: m.workshop_bin_physics_rate_value_label({ rate }),
            checked: rate === simulatedRate,
            run: () => setSimulatedRate(rate),
          }))
        : [],
    ),
    ...listCommands(
      SKIN_PARAMETER_LIST,
      (values ?? []).map((value) => ({
        title: parameterLabel(value),
        checked: value === at,
        run: () => setParameter(value),
      })),
    ),
  });

  /* The map's systems play whatever the skin's own switch says, and stay out of `loaded`,
     whose change is a seek of every effect the skin wears. */
  const played = [...(effects ? worn : []), ...mapParticles.map((group) => group.system)];
  const { warps, softens } = passesOf(played);

  /* A clip changing starts the pose and every idle effect over together, so an effect
     rides the clip from its first frame. The pose a preview mounts on keeps the time the
     clock stood at, which is what a change of frame asks of it. */
  const posed = useRef<Pose | null>(null);
  useEffect(() => {
    if (posed.current !== null && clipPose !== null && posed.current !== clipPose) {
      clock.restart();
    }
    posed.current = clipPose;
  }, [clock, clipPose]);

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
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        <SkinEffectCommands
          document={document}
          asset={asset}
          skin={entry}
          clip={chosen === BIND_POSE ? "" : chosen}
          clipName={chosenClip?.name ?? null}
          idle={idle}
          cues={cues}
          pose={pose}
          scale={scale}
        />
        <div data-ui="SkinViewport:scene" className="relative min-h-0 flex-1">
          <PreviewViewport
            renderer="shared"
            gizmo={!controlsHidden}
            stage={ground}
            textured={midlane}
            backdrop={backdropSource}
            backdropVisibility={backdropVisibility}
            backdropSky={backdropSky}
            background={background}
            captureRef={capture}
            sun={backdrop === null ? null : sun}
            postEffects={backdrop === null ? null : postEffects}
            ambientOcclusion={backdrop === null ? null : ambientOcclusion}
            onBackdropOrigin={setOrigin}
          >
            <Clock clock={clock} playing={playing && !scrubbing} speed={speed} />
            {sound.on && (
              <SoundCues clock={clock} cues={sounds} duration={duration} output={sound.output} />
            )}
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
              <MapCharacters document={mapFile.document} visibility={backdropVisibility} />
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
              <group ref={unit} />
              {driveLive !== null && (
                <LiveRoot
                  onFrame={(seconds, position, yaw) =>
                    driveLive(clock.time, seconds, position, yaw)
                  }
                />
              )}
              <Character
                mesh={mesh.data}
                pose={pose}
                clock={clock}
                bindingOf={bindingFor}
                programsOf={programsFor}
                outlineOf={outlineFor}
                held={heldValue}
                colors={colors}
                hidden={hidden}
                scale={scale}
                selfIllumination={skin.selfIllumination ?? 0}
                highlighted={submesh}
                jointWeights={maskWeights}
                onSubmeshPick={picks.pickSubmesh}
              >
                {effects &&
                  drawn.map(({ key, effect }, at) => {
                    const system = drawnModels[at];
                    if (system === null || system === undefined) return null;
                    return (
                      <JointEffect
                        key={key}
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
                        sound={sound.on ? sound.output : null}
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
                  onPick={picks.pickJoint}
                />
              )}
              {overlaid && (
                <SkinPhysicsOverlay
                  skin={skin}
                  muted={muted}
                  pose={pose}
                  clock={clock}
                  scale={scale}
                  colors={colors}
                  rig={dynamics.rig}
                  shapes={dynamics.shapes}
                />
              )}
              {selectedJoint >= 0 && !controlsHidden && (
                <JointHighlight
                  pose={pose}
                  clock={clock}
                  scale={scale}
                  colors={colors}
                  joint={selectedJoint}
                />
              )}
            </Placement>
            {handle !== null && sendDynamics !== null && socketGizmo && (
              <SocketGizmo
                pose={pose}
                clock={clock}
                scale={scale}
                slot={handle.slot}
                mode={handle.mode}
                space={socketSpace}
                position={stood}
                facing={facing}
                anchor={unit}
                onGrab={() => setPlaying(false)}
                onMove={(place) =>
                  sendDynamics(socketDragEdits(pose, skin.sockets, handle.path, place, handle.mode))
                }
              />
            )}
          </PreviewViewport>
          {!controlsHidden && armature && jointNames && (
            <canvas
              ref={setLabels}
              data-ui="SkinViewport:joint-names"
              aria-hidden
              className="pointer-events-none absolute inset-0 font-mono text-fine select-none"
            />
          )}

          {heldSocket != null && (
            <ViewportControls
              data-ui="SkinViewport:socket-gizmo"
              className="top-auto right-auto bottom-2 left-2"
            >
              <span className="max-w-48 truncate px-1.5 text-meta text-surface-200 select-none">
                {heldSocket.name}
              </span>
              <SocketGizmoMode socket={heldSocket} />
            </ViewportControls>
          )}

          {!controlsHidden && (
            <ViewportControls data-ui="SkinViewport:controls">
              <div className="flex shrink-0 items-center gap-0.5">
                <BackdropToggle />
                {backdrop !== null && (
                  <>
                    <span ref={visibilitySlot} className="contents">
                      <BackdropVisibilityControl backdrop={backdropFlags} />
                    </span>
                    <span ref={sunSlot} className="contents">
                      <SunControl source={backdropSource} />
                    </span>
                    <span ref={postEffectsSlot} className="contents">
                      <PostEffectsControl source={backdropSource} />
                    </span>
                  </>
                )}
              </div>
              <ControlDivider />
              <div className="flex shrink-0 items-center gap-0.5">
                <PlacementToggle />
                {backdrop === null && (
                  <PreviewToggle
                    flag="previewGround"
                    label={m.workshop_bin_preview_stage_label()}
                    icon={<GridFourIcon />}
                  />
                )}
                {backdrop === null && ground && (
                  <PreviewToggle
                    flag="previewMidlane"
                    label={m.workshop_bin_preview_midlane_label()}
                    icon={<MapTrifoldIcon />}
                  />
                )}
                <BackgroundControl />
              </div>
              <ControlDivider />
              <div className="flex shrink-0 items-center gap-0.5">
                {(idle.length > 0 || cues.length > 0) && (
                  <IconButton
                    pressed={effects}
                    icon={<SparkleIcon />}
                    onClick={() => setEffects(!effects)}
                    label={m.workshop_bin_mesh_preview_effects_label()}
                  />
                )}
                <SkinEffectsMenu
                  document={document}
                  asset={asset}
                  skin={entry}
                  clip={chosen === BIND_POSE ? "" : chosen}
                  clipName={chosenClip?.name ?? null}
                  idle={idle}
                  cues={cues}
                  pose={pose}
                  scale={scale}
                />
                <ArmatureMenu />
                {overlaid && (
                  <PhysicsMenu
                    rate={simulates ? simulatedRate : null}
                    onRateChange={setSimulatedRate}
                  />
                )}
                <ShadersToggle />
                <SoundToggle unresolved={sound.unresolved} />
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
              <ControlDivider />
              <div className="flex shrink-0 items-center gap-0.5">
                <ViewModeMenu />
                <CameraMenu />
                <FitButton label={m.workshop_bin_mesh_preview_fit_action()} onFit={refit} />
                <CaptureButton capture={capture} />
              </div>
              <ControlDivider />
              <IconButton
                aria-label={m.workshop_bin_preview_hide_ui_action()}
                icon={<EyeSlashIcon />}
                onClick={() => setControlsHidden(true)}
                tooltip={m.workshop_bin_preview_hide_ui_hint()}
              />
            </ViewportControls>
          )}
        </div>

        {!controlsHidden && (
          <SkinTransport
            ref={transportBox}
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
            onScrubbingChange={setScrubbing}
            onSpeedChange={setSpeed}
            onClipChange={setPicked}
          />
        )}
      </div>
    </>
  );
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
  const maps = useBackdropMaps();
  /* Turning the backdrop off drops which map it drew, so the switch hands the same map
     back rather than returning to the first one in the install. */
  const last = useRef<MapPath | null>(null);
  if (backdrop !== null) last.current = backdrop;

  const opening = last.current ?? maps.data?.[0]?.map ?? null;
  const setBackdrop = useSetPreviewDisplay();

  return (
    <SplitToggle
      label={m.workshop_bin_preview_backdrop_label()}
      pressed={backdrop !== null}
      icon={<MountainsIcon />}
      onClick={() => setBackdrop({ previewBackdrop: backdrop === null ? opening : null })}
      menuLabel={m.workshop_bin_preview_backdrop_menu_label()}
    >
      <Menu.Content align="end" data-ui="BackdropMenu" className="w-52">
        <BackdropItems />
      </Menu.Content>
    </SplitToggle>
  );
}

/** The maps and the switches of the backdrop, which the rail's split control and the View menu list. */
export function BackdropItems() {
  const backdrop = usePreviewBackdrop();
  const particles = usePreviewBackdropParticles();
  const events = usePreviewBackdropEvents();
  const structures = usePreviewBackdropStructures();
  const sky = usePreviewBackdropSky();
  const setDisplay = useSetPreviewDisplay();
  const maps = useBackdropMaps();

  const choices = maps.data ?? [];
  const groups = useMemo(() => groupMaps(maps.data ?? []), [maps.data]);
  const pick = (map: unknown) => setDisplay({ previewBackdrop: map as MapPath | null });

  return (
    <>
      {choices.length === 0 && (
        <Menu.Item disabled>{m.workshop_bin_preview_backdrop_empty_label()}</Menu.Item>
      )}
      <Menu.RadioGroup value={backdrop} onValueChange={pick}>
        <Menu.RadioItem value={null}>{m.workshop_bin_preview_backdrop_none_label()}</Menu.RadioItem>
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
        checked={particles && events}
        disabled={!particles}
        onCheckedChange={(checked) => setDisplay({ previewBackdropEvents: checked })}
      >
        {m.workshop_bin_preview_backdrop_events_label()}
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
    </>
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
    <SplitToggle
      label={
        turning ? m.workshop_bin_preview_move_rotate_label() : m.workshop_bin_preview_move_label()
      }
      pressed={move}
      icon={turning ? <ArrowsClockwiseIcon /> : <ArrowsOutCardinalIcon />}
      /* One button cycles off, move, turn because the mode changes more often than the
         reset action in the attached menu. */
      onClick={() => setDisplay(nextPlacement(move, mode))}
      menuLabel={m.workshop_bin_preview_move_menu_label()}
    >
      <Menu.Content align="end" data-ui="PlacementMenu" className="w-44">
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
      </Menu.Content>
    </SplitToggle>
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
      {/* A map ships up to 37 skins, more than a menu shows without scrolling. */}
      <Menu.SubmenuContent data-ui="BackdropMenu:skins" className="max-h-96 w-56 overflow-y-auto">
        <Menu.RadioGroup value={chosen} onValueChange={onPick}>
          {group.skins.map((skin) => (
            <Menu.RadioItem key={skin.map} value={skin.map} closeOnClick>
              {skin.geometry}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.SubmenuContent>
    </Menu.SubmenuRoot>
  );
}

/** The armature switch and its drawing options as one split control. */
function ArmatureMenu() {
  const armature = usePreviewArmature();
  const jointNames = usePreviewJointNames();
  const setDisplay = useSetPreviewDisplay();

  return (
    <SplitToggle
      label={m.workshop_bin_preview_armature_label()}
      pressed={armature}
      icon={<BoneIcon />}
      onClick={() => setDisplay({ previewArmature: !armature })}
      menuLabel={m.workshop_bin_preview_armature_menu_label()}
    >
      <Menu.Content align="end" data-ui="ArmatureMenu" className="w-44">
        <Menu.CheckboxItem
          checked={armature && jointNames}
          disabled={!armature}
          onCheckedChange={(checked) => setDisplay({ previewJointNames: checked })}
        >
          {m.workshop_bin_preview_joint_names_label()}
        </Menu.CheckboxItem>
      </Menu.Content>
    </SplitToggle>
  );
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
              aria-label={m.workshop_bin_preview_submeshes_label()}
              variant={overridden ? "tonal" : "ghost"}
              icon={<StackIcon />}
            />
          }
        />
      </Tooltip>
      <Menu.Content
        align="end"
        data-ui="SubmeshMenu"
        className="max-h-80 w-56 overflow-y-auto scrollbar-md"
      >
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
      </Menu.Content>
    </Menu.Root>
  );
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
