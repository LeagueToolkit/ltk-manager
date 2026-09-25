import { useFrame } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import type { BinDocumentId } from "@/lib/tauri";
import { FitCamera } from "@/modules/viewport";

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
import { fades } from "../../bin/vfx/rendering/utils/softParticle";
import { definitionBounds } from "../../bin/vfx/rendering/utils/systemBounds";
import {
  EMPTY_OUTCOME,
  FAILED_OUTCOME,
  NO_BURST_OUTCOME,
  type PreviewOutcome,
} from "../state/previewStills";
import { createBurstReader } from "../utils/previewBurst";
import { PREVIEW_GROUND, PREVIEW_MIP_WIDTH } from "../utils/previewFrame";
import { createPreviewPlayback } from "../utils/previewPlayback";
import { createPreviewWarmup } from "../utils/previewWarmup";
import { PreviewCapture } from "./PreviewCapture";
import { PreviewSettled } from "./PreviewSettled";

/** The least and most particle time sampled for a first burst, in seconds. */
const CONTENT_SAMPLE_SECONDS = { least: 2, most: 10 } as const;

/** Where a particle preview's sample is: searching, settled on a burst, empty, or thrown. */
type Sample = "running" | "found" | "missed" | "broken";

interface ParticleSceneProps {
  /** The open the system was read from, whose project resolves custom materials. */
  document: BinDocumentId;
  system: SystemModel;
  /** The preview is on screen and keeps animating after its capture. */
  playing: boolean;
  onOutcome: (outcome: PreviewOutcome) => void;
  /** Called as the preview advances, which restarts the slot's job timeout. */
  onProgress: () => void;
}

type ParticleReadProps = Omit<ParticleSceneProps, "system"> & { entry: string };

/** The particle system `entry` declares in `document`, read and then previewed. */
export function ParticleRead({ document, entry, ...scene }: ParticleReadProps) {
  const { data, isError } = useQuery({ ...vfxQueries.system(document, entry), gcTime: 0 });
  const system = useMemo(() => (data === undefined ? null : readVfxSystem(data)), [data]);
  if (isError) {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={scene.onOutcome} />;
  }
  if (system?.emitters.length === 0) {
    return <PreviewSettled outcome={EMPTY_OUTCOME} onOutcome={scene.onOutcome} />;
  }
  if (system === null) {
    return null;
  }

  return <ParticleScene document={document} system={system} {...scene} />;
}

/**
 * A particle system sampled to a grown first burst, then played.
 *
 * A sample that sees no drawn particle reports a missed burst, which frees a docked slot
 * before the job timeout. A playing preview keeps running after one, so the reader can
 * watch it, and captures a still if a burst appears later. A throw from the simulation
 * reports a failure.
 */
function ParticleScene({ document, system, playing, onOutcome, onProgress }: ParticleSceneProps) {
  const drawn = useMemo(() => drawnEmitters(system), [system]);
  const [textureLoad, reportTextures] = useState<AssetLoad | null>(null);
  const [meshLoad, reportMeshes] = useState<AssetLoad | null>(null);
  const textures = useVfxTextures(drawn, reportTextures, PREVIEW_MIP_WIDTH);
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
  const readBurst = useMemo(() => createBurstReader(drawn), [drawn]);
  const warmup = useMemo(
    () =>
      createPreviewWarmup(advance, {
        seconds: Math.min(
          CONTENT_SAMPLE_SECONDS.most,
          Math.max(CONTENT_SAMPLE_SECONDS.least, lastEmissionStart + 1),
        ),
        oldest: () => readBurst(driver),
      }),
    [driver, advance, lastEmissionStart, readBurst],
  );
  const warps = useMemo(() => drawn.some(({ emitter }) => distorts(emitter)), [drawn]);
  const softens = useMemo(() => drawn.some(({ emitter }) => fades(emitter)), [drawn]);
  const ready = textureLoad?.pending === 0 && meshLoad?.pending === 0;
  const [sample, setSample] = useState<Sample>("running");
  const broken = useRef(false);

  useEffect(() => {
    onProgress();
  }, [onProgress, textureLoad?.pending, meshLoad?.pending, sample]);

  useFrame((_, delta) => {
    if (broken.current) {
      return;
    }

    try {
      if (!warmup.ready) {
        warmup.run();
        if (warmup.ready) setSample(warmup.found ? "found" : "missed");
      } else if (ready) {
        advance(Math.min(delta, 1 / 30));
      }
    } catch (error) {
      broken.current = true;
      console.warn("A particle preview stopped", error);
      setSample("broken");
    }
  }, -1);

  if (sample === "broken") {
    return <PreviewSettled outcome={FAILED_OUTCOME} onOutcome={onOutcome} />;
  }

  if (sample === "missed" && !playing) {
    return <PreviewSettled outcome={NO_BURST_OUTCOME} onOutcome={onOutcome} />;
  }

  return (
    <>
      <Passes warps={warps} softens={softens} />
      <FitCamera bounds={bounds} ground={PREVIEW_GROUND} token={0} animate={false} fit="box" />
      <VfxSystem
        drawn={drawn}
        driver={driver}
        textures={textures}
        meshes={meshes}
        room={4096}
        document={document}
      />
      {sample === "missed" && <PreviewSettled outcome={NO_BURST_OUTCOME} onOutcome={onOutcome} />}
      <PreviewCapture
        ready={ready && sample !== "running"}
        onOutcome={onOutcome}
        hasContent={() => readBurst(driver) !== null}
      />
    </>
  );
}
