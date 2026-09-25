import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClampToEdgeWrapping, type Texture, TextureLoader } from "three";

import { previewUrl } from "@/lib/previewUrl";
import { api, type AssetRef } from "@/lib/tauri";

import { TEXTURE_COLOR_SPACE } from "../utils/world";

/**
 * The ground the stage stands on, out of Summoner's Rift's own kit pieces.
 *
 * Read from the install rather than shipped with the app, so nothing of Riot's is
 * redistributed and an install without the chunk falls back to the flat token fill.
 */
const GROUND_CHUNK = "assets/maps/kitpieces/srs/base/textures/ground_c3_midlanecaps_a.tex";

/** Where the install keeps that chunk, which nothing invalidates for the app's life. */
export const groundQueries = {
  chunk: () =>
    queryOptions<AssetRef | null>({
      queryKey: ["viewport-ground", GROUND_CHUNK],
      queryFn: async () => {
        const answer = await api.objects.locateGameFiles([GROUND_CHUNK]);
        if (!answer.ok) return null;
        const held = answer.value[GROUND_CHUNK];
        if (held === undefined) return null;
        return { kind: "gameChunk", wad: held.wad, pathHash: held.pathHash };
      },
      staleTime: Infinity,
      retry: false,
    }),
};

/**
 * The ground textures read this session, by url, and never disposed.
 *
 * The chunk is one small texture that every stage draws, so a viewport mounting after
 * another finds it ready rather than drawing the flat fill for the frames a load takes.
 */
const LOADED = new Map<string, Texture>();

/** The ground texture, and null while it is on its way or where the install lacks it. */
export function useGroundTexture(): Texture | null {
  const located = useQuery(groundQueries.chunk());
  const asset = located.data ?? null;
  const url = asset === null ? null : previewUrl(asset);

  const [texture, setTexture] = useState<Texture | null>(() =>
    url === null ? null : (LOADED.get(url) ?? null),
  );

  useEffect(() => {
    if (url === null) return;

    const cached = LOADED.get(url);
    if (cached !== undefined) {
      setTexture(cached);
      return;
    }

    let live = true;
    new TextureLoader().load(
      url,
      (loaded) => {
        loaded.colorSpace = TEXTURE_COLOR_SPACE;
        /* One copy centred on the origin, so the ground reads as a piece of a map
           rather than as a repeating pattern the effect is measured against. */
        loaded.wrapS = ClampToEdgeWrapping;
        loaded.wrapT = ClampToEdgeWrapping;
        LOADED.set(url, loaded);
        if (live) setTexture(loaded);
      },
      undefined,
      (error) => console.error("Failed to read the ground texture:", error),
    );

    return () => {
      live = false;
    };
  }, [url]);

  return texture;
}
