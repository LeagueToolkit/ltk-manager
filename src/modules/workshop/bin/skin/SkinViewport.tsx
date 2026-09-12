import { FrameCornersIcon } from "@phosphor-icons/react";
import { useFrame } from "@react-three/fiber";
import { useQueries, useQuery } from "@tanstack/react-query";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconButton, TogglePill, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AnimationClip, AssetRef, BinDocumentId, SkinModel } from "@/lib/tauri";
import {
  Character,
  createPose,
  FitCamera,
  meshBounds,
  type Pose,
  type SceneClock,
  useCharacterTextures,
  useSceneColors,
  Viewport,
  viewportQueries,
} from "@/modules/viewport";
import {
  usePreviewCamera,
  usePreviewGround,
  usePreviewMidlane,
  useSetPreviewDisplay,
} from "@/stores";

import { declaredElsewhere } from "../linkDecision";
import { useBinDocument } from "../useBinDocument";
import { useLinkTargets } from "../useLinkTargets";
import { CameraMenu } from "../vfx/CameraMenu";
import { distorts } from "../vfx/drawKind";
import { Notice } from "../vfx/Notice";
import { Passes } from "../vfx/Passes";
import { fades } from "../vfx/softParticle";
import { vfxQueries } from "../vfx/useVfxSystem";
import { foldedTime } from "./follow";
import { IdleEffect } from "./IdleEffect";
import { SkinChoiceContext, useSkinChoice } from "./skinChoice";
import { skinQueries } from "./skinQueries";
import { BIND_POSE, openingClip, systemModel, textureAssets, textureOf } from "./skinScene";
import { SkinTransport } from "./SkinTransport";
import { useSkinKeys } from "./useSkinKeys";

/** `useFrame` runs the lowest priority first, so the clock moves before anything samples it. */
const BEFORE_THE_SCENE = -1;

const NO_CLIPS: readonly AnimationClip[] = [];

/** Where the character's feet stand, which the match camera stands off. */
const FEET = [0, 0, 0] as const;

export interface SkinViewportProps {
  readonly document: BinDocumentId;
  /** What the document was read from, which tells a graph another file declares apart. */
  readonly asset: AssetRef;
  /** The skin object, `0x` and eight hex digits. */
  readonly entry: string;
}

/**
 * One skin on its skeleton, posed by a clip of its graph and wearing its idle effects.
 *
 * A graph the index says another file declares is read through a second handle, as the
 * idle effect table reads a foreign resolver. Every other graph is read through the
 * skin's own document, which looks in the files it links.
 */
export default function SkinViewport({ document, asset, entry }: SkinViewportProps) {
  const read = useQuery(skinQueries.skin(document, entry));
  const targets = useLinkTargets();
  const graph = read.data?.animationGraph ?? null;
  const elsewhere = graph === null ? null : declaredElsewhere(graph, targets, asset);
  const [opened, setOpened] = useState<BinDocumentId | null>(null);

  if (read.error !== null) return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  if (read.data === undefined) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }

  /* The scene stays mounted while the graph's declaration answers, so the canvas and the
     textures it holds are not built twice. */
  const graphDocument = elsewhere === null ? document : opened;
  return (
    <>
      {elsewhere !== null && graph !== null && (
        <GraphOpener asset={elsewhere} graph={graph} onOpen={setOpened} />
      )}
      <SkinScene skin={read.data} document={document} graphDocument={graphDocument} />
    </>
  );
}

interface GraphOpenerProps {
  readonly asset: AssetRef;
  readonly graph: string;
  readonly onOpen: (document: BinDocumentId | null) => void;
}

/** The graph another file declares, held open beside the skin's own document. */
function GraphOpener({ asset, graph, onOpen }: GraphOpenerProps) {
  const { state } = useBinDocument(asset, graph);
  const opened = state.status === "open" ? state.handle.document : null;
  useEffect(() => {
    onOpen(opened);
    return () => onOpen(null);
  }, [opened, onOpen]);
  return null;
}

interface SkinSceneProps {
  readonly skin: SkinModel;
  /** The skin's own document, which declares the systems its idle effects name. */
  readonly document: BinDocumentId;
  /** The document declaring the skin's animation graph, and null while it opens. */
  readonly graphDocument: BinDocumentId | null;
}

function SkinScene({ skin, document, graphDocument }: SkinSceneProps) {
  const own = useSkinChoice();
  const { clock, picked, setPicked, playing, setPlaying, speed, setSpeed } =
    use(SkinChoiceContext) ?? own;
  const { effects, setEffects } = use(SkinChoiceContext) ?? own;

  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const camera = usePreviewCamera();
  const setDisplay = useSetPreviewDisplay();

  const mesh = useQuery(viewportQueries.mesh(skin.mesh?.asset ?? null));
  const skeleton = useQuery(viewportQueries.skeleton(skin.skeleton?.asset ?? null));
  const clips = useQuery(skinQueries.clips(graphDocument, skin.animationGraph));
  const listed = clips.data ?? NO_CLIPS;

  const held = picked === BIND_POSE || listed.some((clip) => clip.hash === picked) ? picked : null;
  const chosen = held ?? openingClip(listed)?.hash ?? BIND_POSE;
  const clipAsset = listed.find((clip) => clip.hash === chosen)?.animation.asset ?? null;
  const clip = useQuery(viewportQueries.clip(clipAsset));
  const pose = useMemo(
    () => (skeleton.data === undefined ? null : createPose(skeleton.data, clip.data ?? null)),
    [skeleton.data, clip.data],
  );
  const duration = pose?.duration ?? 0;

  const assets = useMemo(() => textureAssets(skin), [skin]);
  const textures = useCharacterTextures(assets);
  const textureFor = useCallback((submesh: string) => textureOf(textures, submesh), [textures]);
  const colors = useSceneColors();
  const scale = skin.scale ?? 1;
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
  const loaded = models.map((model) => (model === null ? "-" : "+")).join("");
  const warps = effects && models.some((model) => model?.emitters.some(distorts) ?? false);
  const softens = effects && models.some((model) => model?.emitters.some(fades) ?? false);

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
      <div
        ref={keys}
        tabIndex={-1}
        data-ui="SkinViewport"
        className="relative min-h-0 flex-1 outline-none"
      >
        <Viewport
          stage={ground}
          textured={midlane}
          camera={camera}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
        >
          <Clock clock={clock} playing={playing} speed={speed} />
          <FitCamera bounds={bounds} ground={FEET} token={fitToken} />
          <Passes warps={warps} softens={softens} />
          <Character
            mesh={mesh.data}
            pose={pose}
            clock={clock}
            textureOf={textureFor}
            untextured={colors.untextured}
            hidden={skin.hidden}
            scale={scale}
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
          </Character>
        </Viewport>

        <div
          data-ui="SkinViewport:controls"
          /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks each button's own size. */
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-surface-veil bg-scrim p-0.5 shadow-md backdrop-blur-sm [&_button]:text-meta"
        >
          <TogglePill
            label={m.workshop_bin_preview_stage_label()}
            active={ground}
            onClick={() => setDisplay({ previewGround: !ground })}
          />
          {ground && (
            <TogglePill
              label={m.workshop_bin_preview_midlane_label()}
              active={midlane}
              onClick={() => setDisplay({ previewMidlane: !midlane })}
            />
          )}
          {idle.length > 0 && (
            <TogglePill
              label={m.workshop_bin_mesh_preview_effects_label()}
              active={effects}
              onClick={() => setEffects(!effects)}
            />
          )}
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
      </div>

      <SkinTransport
        clock={clock}
        duration={duration}
        playing={playing}
        speed={speed}
        clips={listed}
        clip={chosen}
        onPlayingChange={setPlaying}
        onSpeedChange={setSpeed}
        onClipChange={setPicked}
      />
    </>
  );
}

/** The scene's clock, spending each frame's time before the scene is sampled. */
function Clock({ clock, playing, speed }: { clock: SceneClock; playing: boolean; speed: number }) {
  useFrame((_, delta) => {
    if (playing) clock.advance(delta * speed);
  }, BEFORE_THE_SCENE);
  return null;
}
