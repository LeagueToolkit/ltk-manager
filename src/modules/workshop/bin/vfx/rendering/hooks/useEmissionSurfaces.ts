import { useEffect, useMemo, useRef } from "react";

import { previewBufferUrl, type PreviewForm } from "@/lib/previewUrl";
import type { NamedAsset } from "@/lib/tauri";
import { createPose, readClipBuffer, readMeshBuffer, readSkeletonBuffer } from "@/modules/viewport";

import type { EmissionSurfaceModel } from "../../engine/model/model";
import type { Driver } from "../../engine/simulation/driver";
import type { EmissionSampler, EmissionSurfaces } from "../../engine/simulation/emissionSurface";
import type { DrawnEmitter } from "../utils/definitions";
import { meshSurface, skeletonSurface } from "../utils/emissionSurface";

/** One drawn emitter's emission surface, and the signature its sampler is cached under. */
interface SurfaceRequest {
  readonly path: string;
  readonly index: number;
  readonly model: EmissionSurfaceModel;
  readonly signature: string;
}

function surfaceRequests(drawn: readonly DrawnEmitter[]): SurfaceRequest[] {
  return drawn.flatMap(({ path, emitter }) => {
    const model = emitter.emissionSurface;
    if (model === null) return [];
    return [{ path, index: emitter.index, model, signature: JSON.stringify(model) }];
  });
}

const NO_SURFACES: EmissionSurfaces = new Map();

/**
 * Loaded emission surfaces installed before the driver replays its current time.
 *
 * The samplers are cached by what each surface is built from, so an edit that moves no
 * surface hands the driver the samplers it already has and costs no replay.
 */
export function useEmissionSurfaces(drawn: readonly DrawnEmitter[], driver: Driver): void {
  const wanted = useMemo(() => surfaceRequests(drawn), [drawn]);
  const signature = wanted
    .map((request) => `${request.path}:${request.index}|${request.signature}`)
    .join("\n");
  const latest = useRef(wanted);
  latest.current = wanted;
  const cache = useRef(new Map<string, EmissionSampler>());

  useEffect(() => {
    const requests = latest.current;
    const abort = new AbortController();
    const samplers = cache.current;

    const install = () => {
      const wantedSignatures = new Set(requests.map((request) => request.signature));
      for (const key of samplers.keys()) {
        if (!wantedSignatures.has(key)) samplers.delete(key);
      }

      const surfaces = new Map<string, Map<number, EmissionSampler>>();
      for (const { path, index, signature: surfaceKey } of requests) {
        const sampler = samplers.get(surfaceKey);
        if (sampler === undefined) continue;

        let system = surfaces.get(path);
        if (system === undefined) {
          system = new Map();
          surfaces.set(path, system);
        }
        system.set(index, sampler);
      }
      driver.setSurfaces(surfaces.size === 0 ? NO_SURFACES : surfaces);
    };

    const owed = new Map<string, EmissionSurfaceModel>();
    for (const { model, signature: surfaceKey } of requests) {
      if (!samplers.has(surfaceKey)) owed.set(surfaceKey, model);
    }
    if (owed.size === 0) {
      install();
      return;
    }

    void Promise.allSettled(
      [...owed].map(
        async ([surfaceKey, model]) =>
          [surfaceKey, await loadSurface(model, abort.signal)] as const,
      ),
    ).then((results) => {
      if (abort.signal.aborted) return;

      for (const result of results) {
        if (result.status !== "fulfilled") continue;

        const [surfaceKey, sampler] = result.value;
        if (sampler !== null) samplers.set(surfaceKey, sampler);
      }
      install();
    });

    return () => abort.abort();
  }, [signature, driver]);
}

async function loadSurface(
  model: EmissionSurfaceModel,
  signal: AbortSignal,
): Promise<EmissionSampler | null> {
  async function bytes(asset: NamedAsset | null, form: PreviewForm) {
    if (asset?.asset == null) return null;

    const response = await fetch(previewBufferUrl(asset.asset, form), { signal });
    if (!response.ok) throw new Error(`Emission surface ${form} load failed: ${response.status}`);

    return response.arrayBuffer();
  }

  const [mesh, skeleton, clip] = await Promise.all([
    bytes(model.mesh, "geometry"),
    bytes(model.skeleton, "skeleton"),
    bytes(model.animation, "animation"),
  ]);

  const pose =
    skeleton === null
      ? null
      : createPose(readSkeletonBuffer(skeleton), clip === null ? null : readClipBuffer(clip));
  if (model.kind === "skeleton") return pose === null ? null : skeletonSurface(model, pose);

  return mesh === null ? null : meshSurface(model, readMeshBuffer(mesh), pose);
}
