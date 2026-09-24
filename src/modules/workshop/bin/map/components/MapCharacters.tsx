import { useFrame } from "@react-three/fiber";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { Matrix4 } from "three";

import type { AnimationGraph, AssetRef, BinDocumentId, MapCharacter, SkinModel } from "@/lib/tauri";
import {
  Character,
  createPose,
  createSceneClock,
  type MeshGeometry,
  type SceneClock,
  type SceneColors,
  sequencePose,
  type SkeletonModel,
  type SubmeshBinding,
  type SubmeshProgram,
  useAssetTextures,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";
import { usePreviewShaders } from "@/stores";

import { useBinDocument } from "../../documents/hooks/useBinDocument";
import { nameHash } from "../../shared/utils/binHash";
import { skinQueries } from "../../skin/api/skinQueries";
import { useSkinPrograms } from "../../skin/hooks/useSkinPrograms";
import { clipFrameSeconds } from "../../skin/utils/clipEvents";
import { bindingOf, playlistOf, textureAssets } from "../../skin/utils/skinScene";
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

/** `useFrame` runs the lowest priority first, so the clock moves before a pose samples it. */
const BEFORE_THE_POSES = -1;

export interface MapCharactersProps {
  /** The map's open `.materials.bin`, and null until the scene holds it. */
  readonly document: BinDocumentId | null;
  /** Any asset of the project whose layers answer a skin's bin before the install. */
  readonly near: AssetRef;
  /** The visibility flags the backdrop draws, as a mask. */
  readonly flags: number;
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
export function MapCharacters({ document, near, flags, hidden = NONE_HIDDEN }: MapCharactersProps) {
  const placed = useQuery(mapQueries.characters(document));
  const stood = useMemo(() => stoodCharacters(placed.data ?? [], flags), [placed.data, flags]);
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
  useFrame((_, delta) => clock.advance(delta), BEFORE_THE_POSES);

  /* Every skin the map stands rather than the shown ones. The lookup is keyed on this
     list, so hiding one chunk would otherwise re-key it and drop every structure until
     a new answer landed. */
  const paths = useMemo(
    () => [...new Set(stood.map((character) => skinFile(character.skin)))],
    [stood],
  );
  const files = useQuery(mapQueries.filesNear(near, paths)).data;

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

function PlacedSkin({ document, model, graph, characters, clock, colors }: PlacedSkinProps) {
  const mesh = useQuery(viewportQueries.mesh(model.mesh?.asset ?? null));
  const bones = useQuery(viewportQueries.skeleton(model.skeleton?.asset ?? null));
  const assets = useMemo(() => textureAssets(model), [model]);
  const textures = useAssetTextures(assets);
  const binding = useCallback(
    (submesh: string) => bindingOf(model, textures, submesh),
    [model, textures],
  );
  const program = useSkinPrograms(document, model, usePreviewShaders());
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
      programOf={program}
      clock={clock}
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
  readonly programOf: (submesh: string) => SubmeshProgram | null;
  readonly clock: SceneClock;
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
  programOf: program,
  clock,
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

  return characters.map((character, at) => (
    <group key={character.name} matrix={matrices[at]} matrixAutoUpdate={false}>
      <Character
        mesh={mesh}
        pose={pose}
        clock={clock}
        bindingOf={binding}
        programOf={program}
        colors={colors}
        hidden={model.hidden}
        scale={model.scale ?? 1}
        selfIllumination={model.selfIllumination ?? 0}
      />
    </group>
  ));
}
