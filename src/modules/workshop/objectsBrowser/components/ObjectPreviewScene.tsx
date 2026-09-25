import { useFrame } from "@react-three/fiber";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Group, Mesh, MeshLambertMaterial, NoColorSpace } from "three";

import type { AssetRef, BinDocumentId, MaterialProgram, SkinModel } from "@/lib/tauri";
import {
  AXIS_SIGN,
  Character,
  createPose,
  createSceneClock,
  FitCamera,
  MaterialSubject,
  meshBounds,
  PREVIEW_BOUNDS,
  previewGeometry,
  programPasses,
  programTextureAssets,
  useAssetTextures,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";

import { useBinDocument } from "../../bin/documents/hooks/useBinDocument";
import { materialQueries } from "../../bin/material/api/materialQueries";
import { skinQueries } from "../../bin/skin/api/skinQueries";
import { bindingOf, textureAssets } from "../../bin/skin/utils/skinScene";
import { Passes } from "../../bin/vfx/rendering/components/Passes";
import { EMPTY_OUTCOME, FAILED_OUTCOME, type PreviewOutcome } from "../state/previewStills";
import { fallbackTexture } from "../utils/materialFallback";
import { objectPreviewKind } from "../utils/objectPreview";
import type { ObjectRowNode } from "../utils/objectTree";
import { PREVIEW_GROUND, PREVIEW_MIP_WIDTH } from "../utils/previewFrame";
import { ParticleRead } from "./ParticlePreview";
import { PreviewCapture } from "./PreviewCapture";
import { PreviewSettled } from "./PreviewSettled";

/** How fast a hovered character turns, in radians per second. Matches the material turntable. */
const TURN_RATE = 0.5;

type Report = (outcome: PreviewOutcome) => void;

interface SceneProps {
  node: ObjectRowNode;
  /** The preview is on screen and keeps animating after its capture. */
  playing: boolean;
  onOutcome: Report;
  /** Called as the preview advances, which restarts the slot's job timeout. */
  onProgress: () => void;
}

/** One object held open for the grid's shared rendering surface. */
export default function ObjectPreviewScene({ node, playing, onOutcome, onProgress }: SceneProps) {
  const declaration = node.declarations[0]!;
  const { state } = useBinDocument(declaration.asset, node.objectHash);
  const kind = objectPreviewKind(node);

  useEffect(() => {
    if (state.status === "open") onProgress();
  }, [state.status, onProgress]);

  if (state.status === "failed") {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }

  if (state.status !== "open") {
    return null;
  }

  const read = { document: state.handle.document, entry: node.objectHash, onOutcome };
  if (kind === "vfx") {
    return <ParticleRead {...read} playing={playing} onProgress={onProgress} />;
  }

  if (kind === "material") {
    return <MaterialRead {...read} />;
  }

  return <SkinRead {...read} playing={playing} />;
}

interface ReadProps {
  document: BinDocumentId;
  entry: string;
  onOutcome: Report;
}

function SkinRead({ document, entry, onOutcome, playing }: ReadProps & { playing: boolean }) {
  const { data, isError } = useQuery({ ...skinQueries.skin(document, entry), gcTime: 0 });
  if (isError) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }
  if (data !== undefined && (!data.mesh?.asset || !data.skeleton?.asset)) {
    return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
  }
  if (data === undefined) {
    return null;
  }

  return <SkinScene skin={data} playing={playing} onOutcome={onOutcome} />;
}

/** The textured bind pose, turning about the up axis while it plays. */
function SkinScene({
  skin,
  playing,
  onOutcome,
}: {
  skin: SkinModel;
  playing: boolean;
  onOutcome: Report;
}) {
  const meshOptions = viewportQueries.mesh(skin.mesh?.asset ?? null);
  const skeletonOptions = viewportQueries.skeleton(skin.skeleton?.asset ?? null);
  const mesh = useQuery(
    queryOptions({
      ...meshOptions,
      queryKey: ["object-preview", ...meshOptions.queryKey],
      gcTime: 0,
    }),
  );
  const skeleton = useQuery(
    queryOptions({
      ...skeletonOptions,
      queryKey: ["object-preview", ...skeletonOptions.queryKey],
      gcTime: 0,
    }),
  );
  const assets = useMemo(() => textureAssets(skin), [skin]);
  const [load, report] = useState<{ pending: number; failed: number } | null>(null);
  const textures = useAssetTextures(assets, {
    fullWidth: PREVIEW_MIP_WIDTH,
    concurrency: 2,
    report,
  });
  const colors = useSceneColors();
  const clock = useMemo(createSceneClock, []);
  const pose = useMemo(() => skeleton.data && createPose(skeleton.data, null), [skeleton.data]);
  const bindingFor = useCallback(
    (name: string) => bindingOf(skin, textures, name),
    [skin, textures],
  );
  const scale = skin.scale ?? 1;
  const bounds = useMemo(
    () => (mesh.data ? meshBounds(mesh.data, skin.hidden, scale) : null),
    [mesh.data, skin.hidden, scale],
  );
  const turntable = useRef<Group>(null);

  useFrame((_, delta) => {
    if (playing && turntable.current) turntable.current.rotation.y += delta * TURN_RATE;
  });

  if (mesh.isError || skeleton.isError) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }

  if (!mesh.data || !pose) {
    return null;
  }

  return (
    <>
      <Passes warps={false} softens={false} />
      <FitCamera bounds={bounds} ground={PREVIEW_GROUND} token={0} animate={false} fit="box" />
      <group ref={turntable}>
        <Character
          mesh={mesh.data}
          pose={pose}
          clock={clock}
          bindingOf={bindingFor}
          colors={colors}
          hidden={skin.hidden}
          scale={scale}
        />
      </group>
      <PreviewCapture
        ready={load?.pending === 0 && textures.size >= assets.size - load.failed}
        onOutcome={onOutcome}
      />
    </>
  );
}

function MaterialRead({ document, entry, onOutcome }: ReadProps) {
  const { data, isError } = useQuery({ ...materialQueries.program(document, entry), gcTime: 0 });
  if (isError) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }
  if (data === null) {
    return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
  }
  if (data === undefined) {
    return null;
  }

  return <MaterialScene program={data} onOutcome={onOutcome} />;
}

/**
 * The material on a turning sphere, its translated passes drawn with the game's shaders.
 *
 * A material with no translated pass draws its base texture instead, and one with no
 * texture either reports an empty outcome.
 */
function MaterialScene({ program, onOutcome }: { program: MaterialProgram; onOutcome: Report }) {
  const programs = useMemo(() => [program], [program]);
  const assets = useMemo(() => programTextureAssets(programs), [programs]);
  const [load, report] = useState<{ pending: number; failed: number } | null>(null);
  const textures = useAssetTextures(assets, {
    colorSpace: NoColorSpace,
    fullWidth: PREVIEW_MIP_WIDTH,
    concurrency: 2,
    report,
  });
  const drawn = useMemo(() => programPasses(program, textures), [program, textures]);
  const fallback = useMemo(() => fallbackTexture(program), [program]);

  if (programPasses(program, EMPTY_TEXTURES).length === 0) {
    if (fallback === null) {
      return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
    }

    return <TexturedSphere asset={fallback} onOutcome={onOutcome} />;
  }

  return (
    <>
      <Passes warps={false} softens={false} />
      <FitCamera
        bounds={PREVIEW_BOUNDS}
        ground={PREVIEW_GROUND}
        token={0}
        animate={false}
        fit="box"
      />
      <MaterialSubject
        programs={drawn}
        skinned={program.kind === "skinnedMesh"}
        shape="sphere"
        turntable
      />
      <PreviewCapture
        ready={load?.pending === 0 && textures.size >= assets.size - load.failed}
        onOutcome={onOutcome}
      />
    </>
  );
}

const EMPTY_TEXTURES: ReadonlyMap<string, unknown> = new Map<string, unknown>();

const FALLBACK_TEXTURE = "fallback";

/** One texture on a lit, turning preview sphere, mirrored into the engine's space as `MaterialSubject` is. */
function TexturedSphere({ asset, onOutcome }: { asset: AssetRef; onOutcome: Report }) {
  const assets = useMemo(() => new Map([[FALLBACK_TEXTURE, asset]]), [asset]);
  const [load, report] = useState<{ pending: number; failed: number } | null>(null);
  const textures = useAssetTextures(assets, {
    fullWidth: PREVIEW_MIP_WIDTH,
    concurrency: 1,
    report,
  });
  const map = textures.get(FALLBACK_TEXTURE) ?? null;
  const geometry = useMemo(() => previewGeometry("sphere", false), []);
  const material = useMemo(() => new MeshLambertMaterial(), []);
  const sphere = useMemo(() => {
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(...AXIS_SIGN);
    return mesh;
  }, [geometry, material]);

  useLayoutEffect(() => {
    material.map = map;
    material.needsUpdate = true;
  }, [material, map]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    sphere.rotation.y += delta * TURN_RATE;
  });

  if (load !== null && load.failed > 0) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }

  return (
    <>
      <Passes warps={false} softens={false} />
      <FitCamera
        bounds={PREVIEW_BOUNDS}
        ground={PREVIEW_GROUND}
        token={0}
        animate={false}
        fit="box"
      />
      <primitive object={sphere} />
      <PreviewCapture ready={load?.pending === 0 && map !== null} onOutcome={onOutcome} />
    </>
  );
}
