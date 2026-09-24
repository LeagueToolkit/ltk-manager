import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { type CubeTexture, SRGBColorSpace } from "three";

import { previewCubeUrl } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";

import { loadCubeTexture } from "../../shared/utils/cubeTexture";
import { createRetainedCache, useRetained } from "../../shared/utils/retainedCache";
import { backdropQueries } from "../hooks/useMapBackdrop";

/** One sky's load, shared by every viewport drawing it. */
interface SkyLoad {
  readonly texture: () => CubeTexture | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
}

const SKIES = createRetainedCache<string, SkyLoad>((sky) => sky.dispose());

/**
 * The sky behind a map backdrop, in place of the stage's flat colour.
 *
 * No map declares a sky of its own. The install ships one cube map under
 * `assets/maps/skyboxes`, in every map's archive, and this draws it for whichever map is
 * on. It is drawn across the scene's one mirrored axis like everything else, which a sky
 * does not show. An install without the file keeps the flat colour.
 */
export function Sky() {
  const asset = useQuery(backdropQueries.sky()).data ?? null;
  if (asset === null) return null;
  return <SkyOf asset={asset} />;
}

function SkyOf({ asset }: { asset: AssetRef }) {
  const sky = useRetained(SKIES, JSON.stringify(asset), () => loadSky(asset));
  const texture = useSyncExternalStore(sky.subscribe, sky.texture);
  if (texture === null) return null;
  return <primitive attach="background" object={texture} />;
}

function loadSky(asset: AssetRef): SkyLoad {
  let live = true;
  let started = false;
  let held: CubeTexture | null = null;
  const listeners = new Set<() => void>();

  const start = () => {
    if (started) return;
    started = true;

    void loadCubeTexture(previewCubeUrl(asset)).then((cube) => {
      if (cube === null) return;
      if (!live) {
        cube.dispose();
        return;
      }

      cube.colorSpace = SRGBColorSpace;
      held = cube;
      for (const listener of listeners) listener();
    });
  };

  return {
    texture: () => held,
    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      live = false;
      held?.dispose();
      listeners.clear();
    },
  };
}
