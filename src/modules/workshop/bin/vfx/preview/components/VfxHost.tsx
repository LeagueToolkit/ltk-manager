import { useFrame } from "@react-three/fiber";
import {
  keepPreviousData,
  queryOptions,
  skipToken,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { type ReactNode, use, useEffect, useMemo } from "react";

import { api, type AssetRef, type BinRow, type GraphClip } from "@/lib/tauri";
import {
  Character,
  createPose,
  createSceneClock,
  sequencePose,
  useAssetTextures,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";
import { queryFnWithArgs } from "@/utils/query";

import { nameHash } from "../../../shared/utils/binHash";
import { skinQueries } from "../../../skin/api/skinQueries";
import {
  bindingOf,
  jointsOf,
  playableClips,
  playlistOf,
  HELD_TEXTURES,
  textureAssets,
} from "../../../skin/utils/skinScene";
import { useVfxRun, VfxRunContext } from "../../playback/state/run";
import { takeHandedHost, useHandedRigStore } from "../../playback/state/vfxRunMemory";
import { chooseHost, hostKey, useHostChoice } from "../state/hostChoice";

const NO_CLIPS: readonly GraphClip[] = [];
const NO_TEXTURES: ReadonlyMap<string, AssetRef> = new Map();
const SKINS: ReadonlySet<string> = new Set([
  nameHash("SkinCharacterDataProperties"),
  nameHash("TftSkinCharacterDataProperties"),
]);

const NO_SKINS: readonly BinRow[] = [];

/**
 * The skins of the open document that can host a particle preview, and the run's host.
 *
 * The viewport and the inspector both call it. Outside a run it returns no skin.
 */
export function useHostSkin() {
  const run = use(VfxRunContext);
  const document = run?.document ?? null;
  const key = run === null ? "" : hostKey(run.document, run.entry);
  const choice = useHostChoice(key);
  const roots = useQuery(
    queryOptions({
      queryKey: ["bin-file-roots", document],
      queryFn: document === null ? skipToken : queryFnWithArgs(api.bin.roots, document),
      staleTime: Infinity,
    }),
  );
  const skins = useMemo(
    () =>
      (roots.data ?? NO_SKINS).filter(
        (row) => row.value.type === "struct" && SKINS.has(row.value.classHash),
      ),
    [roots.data],
  );
  const entry = skins.some((row) => row.entry === choice.skin) ? choice.skin : "";
  const skin = useQuery({
    ...skinQueries.skin(document ?? 0, entry),
    enabled: document !== null && entry !== "",
  });

  return {
    key,
    skins,
    selected: entry,
    /** The chosen skin's name. Null for no character. */
    name: skins.find((row) => row.entry === entry)?.name ?? null,
    animation: choice.clip,
    offset: choice.offset,
    model: entry === "" ? undefined : skin.data,
  };
}

/**
 * The run's host skin and its clip, loaded from the open particle document.
 *
 * A skin the system was opened from hands its own skin, clip and the event's frame. A run
 * opened any other way has no host. `joints` are the posed character's, sampled on the host's
 * clock, and null until the pose loads.
 */
export function useVfxHost() {
  const { document, entry: system } = useVfxRun();
  const { key, animation, offset, model } = useHostSkin();
  const handed = useHandedRigStore((state) => state.hosts[system.toLowerCase()] ?? null);
  useEffect(() => {
    if (handed === null) return;

    const taken = takeHandedHost(system);
    if (taken === null) return;

    chooseHost(key, { skin: taken.skin, clip: taken.clip, offset: taken.offset });
  }, [handed, system, key]);

  const graph = useQuery(skinQueries.graph(document, model?.animationGraph ?? null));
  const clips = graph.data?.clips ?? NO_CLIPS;
  const playable = useMemo(() => playableClips(clips), [clips]);
  const picked = playable.find((clip) => clip.hash === animation);
  const steps = useMemo(
    () => (picked === undefined ? [] : playlistOf(picked, clips)),
    [picked, clips],
  );
  const loaded = useQueries({
    queries: steps.map((clip) => viewportQueries.clip(clip.animation?.asset ?? null)),
    combine: clipData,
  });
  /* A change of chosen layers can swap either file, and the old one draws until the new lands. */
  const mesh = useQuery({
    ...viewportQueries.mesh(model?.mesh?.asset ?? null),
    placeholderData: keepPreviousData,
  });
  const skeleton = useQuery({
    ...viewportQueries.skeleton(model?.skeleton?.asset ?? null),
    placeholderData: keepPreviousData,
  });

  const pose = useMemo(() => {
    const held = skeleton.data;
    if (held === undefined) return null;
    if (loaded.some((clip) => clip === undefined)) return null;

    return sequencePose(
      held,
      loaded.map((clip) => createPose(held, clip ?? null)),
    );
  }, [skeleton.data, loaded]);
  const scale = model?.scale ?? 1;
  const joints = useMemo(
    () => (pose === null ? null : jointsOf(pose, scale, offset)),
    [pose, scale, offset],
  );
  const assets = useMemo(() => (model === undefined ? NO_TEXTURES : textureAssets(model)), [model]);
  const textures = useAssetTextures(assets, HELD_TEXTURES);

  return {
    offset,
    model,
    mesh: mesh.data,
    pose,
    joints,
    textures,
    ready: model !== undefined && mesh.data !== undefined && pose !== null,
  };
}

type Host = ReturnType<typeof useVfxHost>;

/** The host shares the particle run's clock and provides the attached mesh draw context. */
export function VfxHost({ host, children }: { readonly host: Host; readonly children: ReactNode }) {
  const { driver } = useVfxRun();
  const colors = useSceneColors();
  const clock = useMemo(createSceneClock, []);

  useFrame(() => clock.seek(driver.time + host.offset), -1);

  if (!host.ready || host.model === undefined || host.mesh === undefined || host.pose === null)
    return children;

  const model = host.model;

  return (
    <Character
      mesh={host.mesh}
      pose={host.pose}
      clock={clock}
      scale={model.scale ?? 1}
      hidden={model.hidden}
      colors={colors}
      bindingOf={(submesh) => bindingOf(model, host.textures, submesh)}
    >
      {children}
    </Character>
  );
}

/* Module scope, so the query keeps its combined result rather than a new array per render. */
function clipData<T>(results: readonly { data: T }[]): T[] {
  return results.map((result) => result.data);
}
