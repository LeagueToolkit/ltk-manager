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
  programTextureAssets,
  programWith,
  useAssetTextures,
  useSceneColors,
  viewportQueries,
} from "@/modules/viewport";

import { useBinDocument } from "../../bin/documents/hooks/useBinDocument";
import { materialQueries } from "../../bin/material/api/materialQueries";
import { skinQueries } from "../../bin/skin/api/skinQueries";
import { bindingOf, textureAssets } from "../../bin/skin/utils/skinScene";
import type { SystemModel } from "../../bin/vfx/engine/model/model";
import { FIRST_RIG } from "../../bin/vfx/engine/model/rig";
import { systemSpan } from "../../bin/vfx/engine/model/systemModel";
import { readVfxSystem } from "../../bin/vfx/engine/parsing/readVfxSystem";
import { createDriver } from "../../bin/vfx/engine/simulation/driver";
import { vfxQueries } from "../../bin/vfx/hooks/useVfxSystem";
import { Passes } from "../../bin/vfx/rendering/components/Passes";
import { VfxSystem } from "../../bin/vfx/rendering/components/VfxSystem";
import { useVfxMeshes } from "../../bin/vfx/rendering/hooks/useVfxMeshes";
import { useVfxTextures } from "../../bin/vfx/rendering/hooks/useVfxTextures";
import { type AssetLoad } from "../../bin/vfx/rendering/utils/assetLoad";
import { drawnEmitters } from "../../bin/vfx/rendering/utils/definitions";
import { distorts } from "../../bin/vfx/rendering/utils/drawKind";
import { definitionBounds } from "../../bin/vfx/rendering/utils/systemBounds";
import { EMPTY_OUTCOME, FAILED_OUTCOME, type PreviewOutcome } from "../state/previewStills";
import { fallbackTexture } from "../utils/materialFallback";
import { objectPreviewKind } from "../utils/objectPreview";
import type { ObjectRowNode } from "../utils/objectTree";
import { createPreviewPlayback } from "../utils/previewPlayback";
import { createPreviewWarmup } from "../utils/previewWarmup";
import { PreviewSettled } from "./PreviewSettled";

const MIP_WIDTH = 128;
const ORIGIN = [0, 0, 0] as const;

/** The least and most particle time sampled for a first burst, in seconds. */
const CONTENT_SAMPLE_SECONDS = { least: 2, most: 10 } as const;

/** How fast a hovered character turns, in radians per second. Matches the material turntable. */
const TURN_RATE = 0.5;

type Report = (outcome: PreviewOutcome) => void;

interface SceneProps {
  node: ObjectRowNode;
  /** The preview is on screen and keeps animating after its capture. */
  playing: boolean;
  onOutcome: Report;
}

/** One object held open for the grid's shared rendering surface. */
export default function ObjectPreviewScene({ node, playing, onOutcome }: SceneProps) {
  const declaration = node.declarations[0]!;
  const { state } = useBinDocument(declaration.asset, node.objectHash);
  const kind = objectPreviewKind(node);

  if (state.status === "failed") {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }

  if (state.status !== "open") {
    return null;
  }

  const read = { document: state.handle.document, entry: node.objectHash, onOutcome };
  if (kind === "vfx") {
    return <ParticleRead {...read} />;
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

function ParticleRead({ document, entry, onOutcome }: ReadProps) {
  const { data, isError } = useQuery({ ...vfxQueries.system(document, entry), gcTime: 0 });
  const system = useMemo(() => (data === undefined ? null : readVfxSystem(data)), [data]);
  if (isError) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }
  if (system?.emitters.length === 0) {
    return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
  }
  if (system === null) {
    return null;
  }

  return <ParticleScene system={system} onOutcome={onOutcome} />;
}

/**
 * A particle system sampled to its first burst, then played.
 *
 * A system with no live particle at the end of its sample reports an empty outcome, which
 * frees its slot before the job timeout.
 */
function ParticleScene({ system, onOutcome }: { system: SystemModel; onOutcome: Report }) {
  const drawn = useMemo(() => drawnEmitters(system), [system]);
  const [textureLoad, reportTextures] = useState<AssetLoad | null>(null);
  const [meshLoad, reportMeshes] = useState<AssetLoad | null>(null);
  const textures = useVfxTextures(drawn, reportTextures, MIP_WIDTH);
  const meshes = useVfxMeshes(drawn, reportMeshes);
  const driver = useMemo(() => {
    const next = createDriver(1337, { capacity: 4096, seekable: false });
    next.swap(system);
    next.steer({ ...FIRST_RIG.rig, life: "once" });
    return next;
  }, [system]);
  const bounds = useMemo(() => definitionBounds(system, drawn, FIRST_RIG.rig), [system, drawn]);
  const lastEmissionStart = useMemo(
    () =>
      Math.max(
        0,
        ...system.emitters
          .filter((emitter) => !emitter.disabled)
          .map((emitter) => emitter.timeBeforeFirstEmission),
      ),
    [system],
  );
  const advance = useMemo(
    () => createPreviewPlayback(driver, systemSpan(system), lastEmissionStart),
    [driver, system, lastEmissionStart],
  );
  const warmup = useMemo(
    () =>
      createPreviewWarmup(advance, {
        seconds: Math.min(
          CONTENT_SAMPLE_SECONDS.most,
          Math.max(CONTENT_SAMPLE_SECONDS.least, lastEmissionStart + 1),
        ),
        hasContent: () => driver.pool.count > 0 || driver.liveChildren() > 0,
      }),
    [driver, advance, lastEmissionStart],
  );
  const ready = textureLoad?.pending === 0 && meshLoad?.pending === 0;
  const [drawsNothing, setDrawsNothing] = useState(false);

  useFrame((_, delta) => {
    if (!warmup.ready) {
      warmup.run();
      if (warmup.ready && !warmup.found) setDrawsNothing(true);
    } else if (ready) {
      advance(Math.min(delta, 1 / 30));
    }
  }, -1);

  if (drawsNothing) {
    return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
  }

  return (
    <>
      <Passes warps={drawn.some(({ emitter }) => distorts(emitter))} softens={false} />
      <FitCamera bounds={bounds} ground={ORIGIN} token={0} animate={false} fit="box" />
      <VfxSystem drawn={drawn} driver={driver} textures={textures} meshes={meshes} room={4096} />
      <Capture
        ready={ready}
        onOutcome={onOutcome}
        hasContent={() => warmup.ready && (driver.pool.count > 0 || driver.liveChildren() > 0)}
      />
    </>
  );
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
    fullWidth: MIP_WIDTH,
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
      <FitCamera bounds={bounds} ground={ORIGIN} token={0} animate={false} fit="box" />
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
      <Capture
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
 * The material on a turning sphere, its first translated pass drawn with the game's shader.
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
    fullWidth: MIP_WIDTH,
    concurrency: 2,
    report,
  });
  const drawn = useMemo(() => programWith(program, textures), [program, textures]);
  const fallback = useMemo(() => fallbackTexture(program), [program]);

  if (programWith(program, EMPTY_TEXTURES) === null) {
    if (fallback === null) {
      return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={onOutcome} />;
    }

    return <TexturedSphere asset={fallback} onOutcome={onOutcome} />;
  }

  return (
    <>
      <Passes warps={false} softens={false} />
      <FitCamera bounds={PREVIEW_BOUNDS} ground={ORIGIN} token={0} animate={false} fit="box" />
      <MaterialSubject
        program={drawn}
        skinned={program.kind === "skinnedMesh"}
        shape="sphere"
        turntable
      />
      <Capture
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
  const textures = useAssetTextures(assets, { fullWidth: MIP_WIDTH, concurrency: 1, report });
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
      <FitCamera bounds={PREVIEW_BOUNDS} ground={ORIGIN} token={0} animate={false} fit="box" />
      <primitive object={sphere} />
      <Capture ready={load?.pending === 0 && map !== null} onOutcome={onOutcome} />
    </>
  );
}

/** A still after assets and camera have settled, copied immediately after the colour pass. */
function Capture({
  ready,
  onOutcome,
  hasContent,
}: {
  ready: boolean;
  onOutcome: Report;
  hasContent?: () => boolean;
}) {
  const frames = useRef(0);
  const captured = useRef(false);

  useFrame(({ gl, controls }) => {
    if (!ready || !controls || captured.current) {
      return;
    }

    frames.current += 1;
    if (frames.current < 2 || (hasContent && !hasContent())) {
      return;
    }

    captured.current = true;
    try {
      const image = gl.domElement.toDataURL("image/webp", 0.75);
      onOutcome(image.startsWith("data:image/") ? { kind: "image", src: image } : FAILED_OUTCOME);
    } catch {
      onOutcome(FAILED_OUTCOME);
    }
  }, 2);

  return null;
}
