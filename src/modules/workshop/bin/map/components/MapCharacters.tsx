import { useFrame } from "@react-three/fiber";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef } from "react";
import { Box3, Frustum, Matrix4, Sphere } from "three";

import type { AnimationGraph, AssetRef, BinDocumentId, MapCharacter, SkinModel } from "@/lib/tauri";
import {
  AXIS_SIGN,
  Character,
  createPose,
  createSceneClock,
  type MapVisibility,
  type MeshGeometry,
  type SceneClock,
  type SceneColors,
  sequencePose,
  ShownGroup,
  type SkeletonModel,
  type SubmeshBinding,
  type SubmeshProgram,
  useAssetTextures,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";
import { usePreviewShaders } from "@/stores";

import { useSandbox } from "../../../sandbox/state/SandboxContext";
import { useBinDocument } from "../../documents/hooks/useBinDocument";
import { nameHash } from "../../shared/utils/binHash";
import { skinQueries } from "../../skin/api/skinQueries";
import { useSkinPrograms } from "../../skin/hooks/useSkinPrograms";
import { clipFrameSeconds } from "../../skin/utils/clipEvents";
import { bindingOf, HELD_TEXTURES, playlistOf, textureAssets } from "../../skin/utils/skinScene";
import { mapQueries } from "../api/mapQueries";
import {
  charactersByAnimation,
  charactersBySkin,
  idleClip,
  sceneMatrix,
  skinFile,
  stoodCharacters,
} from "../utils/mapCharacters";
import { isHidden } from "../utils/mapOutline";
import { placeableKey } from "../utils/placeables";

/**
 * `useFrame` runs the lowest priority first, so the clock moves and the frustum is this
 * frame's before a character is tested against it and posed.
 */
const BEFORE_THE_POSES = -1;

/**
 * How far a pose is taken to carry a vertex from where the bind pose has it, as a multiple
 * of the bind pose's radius. A mesh states the bounds of its bind pose alone.
 */
const POSE_SLACK = 2;

const PROJECTION = new Matrix4();

export interface MapCharactersProps {
  /** The map's open `.materials.bin`, and null until the scene holds it. */
  readonly document: BinDocumentId | null;
  /** The backdrop's active flags and controller states. */
  readonly visibility: MapVisibility;
  /** The chunks and placeables an outliner hid, which a backdrop has none of. */
  readonly hidden?: ReadonlySet<string>;
}

const NONE_HIDDEN: ReadonlySet<string> = new Set();

/**
 * The structures and level props a backdrop's map stands in its scene, each idling.
 *
 * Each skin is read once out of the character's own bin, which is a file apart from the
 * map's, and drawn at every place the map stands it. They run on a clock of their own
 * rather than the scene's, since a map's banners wave on through a clip that restarts.
 */
export function MapCharacters({ document, visibility, hidden = NONE_HIDDEN }: MapCharactersProps) {
  const sandbox = useSandbox();
  const placed = useQuery(mapQueries.characters(document));
  const stood = useMemo(
    () => stoodCharacters(placed.data ?? [], visibility),
    [placed.data, visibility],
  );
  const skins = useMemo(
    () => [
      ...charactersBySkin(
        stood.filter((character) => !isHidden(hidden, character.chunk, character.key)),
      ),
    ],
    [stood, hidden],
  );
  const colors = useSceneColors();
  const clock = useMemo(createSceneClock, []);
  const seen = useMemo(() => new Frustum(), []);
  useFrame(({ camera }, delta) => {
    clock.advance(delta);

    /* The controls moved the camera earlier in this frame, and ThreeJS updates its
       matrices only as it renders. */
    camera.updateMatrixWorld();
    PROJECTION.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    seen.setFromProjectionMatrix(PROJECTION);
  }, BEFORE_THE_POSES);

  /* Every skin the map stands rather than the shown ones. The lookup is keyed on this
     list, so hiding one chunk would otherwise re-key it and drop every structure until
     a new answer landed. */
  const paths = useMemo(
    () => [...new Set(stood.map((character) => skinFile(character.skin)))],
    [stood],
  );
  const files = useQuery(mapQueries.filesNear(sandbox, paths)).data;

  /* A skin whose bin nothing holds is a prop the map draws without. */
  return skins.map(([skin, characters]) => {
    const asset = files?.[skinFile(skin)];
    if (asset === undefined) return null;
    return (
      <OpenedSkin
        key={skin}
        skin={skin}
        characters={characters}
        clock={clock}
        seen={seen}
        colors={colors}
        asset={asset}
      />
    );
  });
}

interface SkinProps {
  /** The skin's entry path, `Characters/Turret/Skins/Skin0`. */
  readonly skin: string;
  readonly characters: readonly MapCharacter[];
  readonly clock: SceneClock;
  /** What the camera sees this frame, in the scene's space. */
  readonly seen: Frustum;
  readonly colors: SceneColors;
}

function OpenedSkin({ asset, ...props }: SkinProps & { readonly asset: AssetRef }) {
  const { state } = useBinDocument(asset);
  if (state.status !== "open") return null;
  return <ReadSkin {...props} document={state.handle.document} />;
}

/* The graph read looks in the files the skin's bin links, which is where a character
   keeps its animations. */
function ReadSkin({ document, ...props }: SkinProps & { readonly document: BinDocumentId }) {
  const skin = useQuery(skinQueries.skin(document, nameHash(props.skin)));
  const graphRead = useQuery(skinQueries.graph(document, skin.data?.animationGraph ?? null));
  if (skin.data === undefined) return null;
  return (
    <PlacedSkin {...props} document={document} model={skin.data} graph={graphRead.data ?? null} />
  );
}

interface PlacedSkinProps extends SkinProps {
  /** The skin's bin, which the programs of its materials are read from. */
  readonly document: BinDocumentId;
  readonly model: SkinModel;
  /** The skin's graph, and null while it reads and where the skin names none. */
  readonly graph: AnimationGraph | null;
}

function PlacedSkin({ document, model, graph, characters, clock, seen, colors }: PlacedSkinProps) {
  /* A change of chosen layers can swap either file, and the old one draws until the new lands. */
  const mesh = useQuery({
    ...viewportQueries.mesh(model.mesh?.asset ?? null),
    placeholderData: keepPreviousData,
  });
  const bones = useQuery({
    ...viewportQueries.skeleton(model.skeleton?.asset ?? null),
    placeholderData: keepPreviousData,
  });
  const assets = useMemo(() => textureAssets(model), [model]);
  const textures = useAssetTextures(assets, HELD_TEXTURES);
  const binding = useCallback(
    (submesh: string) => bindingOf(model, textures, submesh),
    [model, textures],
  );
  const programs = useSkinPrograms(
    document,
    model,
    usePreviewShaders(),
    Boolean(mesh.data?.tangents),
  );
  const groups = useMemo(() => [...charactersByAnimation(characters)], [characters]);

  if (mesh.data === undefined || bones.data === undefined) return null;
  return groups.map(([animation, posed]) => (
    <PosedCharacters
      key={animation ?? ""}
      animation={animation}
      characters={posed}
      graph={graph}
      mesh={mesh.data}
      skeleton={bones.data}
      model={model}
      bindingOf={binding}
      programsOf={programs}
      clock={clock}
      seen={seen}
      colors={colors}
    />
  ));
}

interface PosedCharactersProps {
  /** The clip the map names for these, and null for the one the graph idles on. */
  readonly animation: string | null;
  readonly characters: readonly MapCharacter[];
  readonly graph: AnimationGraph | null;
  readonly mesh: MeshGeometry;
  readonly skeleton: SkeletonModel;
  readonly model: SkinModel;
  readonly bindingOf: (submesh: string) => SubmeshBinding;
  readonly programsOf: (submesh: string) => readonly SubmeshProgram[];
  readonly clock: SceneClock;
  readonly seen: Frustum;
  readonly colors: SceneColors;
}

/** Every place a map stands one skin on one clip, which is one pose between them. */
function PosedCharacters({
  animation,
  characters,
  graph,
  mesh,
  skeleton,
  model,
  bindingOf: binding,
  programsOf: programs,
  clock,
  seen,
  colors,
}: PosedCharactersProps) {
  const playlist = useMemo(() => {
    const clip = graph === null ? null : idleClip(graph.clips, animation);
    return clip === null || graph === null ? [] : playlistOf(clip, graph.clips);
  }, [graph, animation]);
  const clips = useQueries({
    queries: playlist.map((step) => viewportQueries.clip(step.animation?.asset ?? null)),
    combine: (results) => results.map((result) => result.data ?? null),
  });
  /* A sequence of nothing is the bind pose, which is what a skin with no graph stands in. */
  const pose = useMemo(
    () =>
      sequencePose(
        skeleton,
        clips.map((clip, at) =>
          createPose(skeleton, clip, clipFrameSeconds(playlist[at], clip?.fps ?? null)),
        ),
      ),
    [skeleton, clips, playlist],
  );
  const matrices = useMemo(
    () => characters.map((character) => new Matrix4().fromArray(sceneMatrix(character.transform))),
    [characters],
  );

  const scale = model.scale ?? 1;
  const { positions } = mesh;
  const reach = useMemo(() => poseReach(positions, scale), [positions, scale]);

  return characters.map((character, at) => {
    const matrix = matrices[at];
    if (matrix === undefined) return null;

    return (
      <PlacedCharacter key={placeableKey(character)} matrix={matrix} reach={reach} seen={seen}>
        {(asleep) => (
          <Character
            mesh={mesh}
            pose={pose}
            clock={clock}
            bindingOf={binding}
            programsOf={programs}
            colors={colors}
            hidden={model.hidden}
            scale={scale}
            selfIllumination={model.selfIllumination ?? 0}
            asleep={asleep}
          />
        )}
      </PlacedCharacter>
    );
  });
}

/**
 * The sphere that holds every pose of a mesh with the bind `positions` drawn at `scale`, in
 * the space of the group a character is placed under.
 */
function poseReach(positions: Float32Array, scale: number): Sphere {
  const sphere = new Box3().setFromArray(positions).getBoundingSphere(new Sphere());
  sphere.center.set(
    sphere.center.x * AXIS_SIGN[0] * scale,
    sphere.center.y * AXIS_SIGN[1] * scale,
    sphere.center.z * AXIS_SIGN[2] * scale,
  );
  sphere.radius *= Math.abs(scale) * POSE_SLACK;
  return sphere;
}

interface PlacedCharacterProps {
  /** Where the map stands the character, in the scene's space. */
  readonly matrix: Matrix4;
  /** The sphere that holds every pose of the character, before `matrix` places it. */
  readonly reach: Sphere;
  readonly seen: Frustum;
  /** The character, given the flag that is true while the camera does not see it. */
  readonly children: (asleep: { readonly current: boolean }) => ReactNode;
}

/**
 * One character where the map stands it, drawn and posed only while the camera sees it.
 *
 * A character out of view is hidden, so ThreeJS skips its draw and its skeleton, and its
 * pose is not sampled. One in view changes every frame, so it keeps an on-demand viewport
 * drawing.
 */
function PlacedCharacter({ matrix, reach, seen, children }: PlacedCharacterProps) {
  const group = useMemo(() => new ShownGroup(), []);
  const asleep = useRef(false);
  const placed = useMemo(() => reach.clone().applyMatrix4(matrix), [reach, matrix]);

  useFrame(({ invalidate }) => {
    const inView = seen.intersectsSphere(placed);
    asleep.current = !inView;
    group.visible = inView;
    if (inView) invalidate();
  });

  return (
    <primitive object={group} matrix={matrix} matrixAutoUpdate={false}>
      {children(asleep)}
    </primitive>
  );
}
