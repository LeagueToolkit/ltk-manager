import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type { CharacterInking, InkingSide } from "@/lib/tauri";

import { inkingOf } from "../builtinMods";
import { leagueInstallQueries } from "./queries";
import { useUpdateSettings } from "./useUpdateSettings";

/** Every map of the install at `leaguePath` that character inking can draw the outline on. */
export function useInkingMaps(leaguePath: string | null | undefined) {
  return useQuery(leagueInstallQueries.inkingMaps(leaguePath));
}

/** The preview project of `champion`, written by the backend. */
export function useInkingPreview(champion: string) {
  return useQuery(leagueInstallQueries.inkingPreview(champion));
}

/** The outline values the overlay build writes for `settings` on `side`. */
export function useInkingOutline(settings: CharacterInking, side: InkingSide) {
  return useQuery(leagueInstallQueries.inkingOutline(settings, side));
}

/** Saves a change to some character inking fields, merged onto the latest settings. */
export function useUpdateInking() {
  const update = useUpdateSettings();

  return useCallback(
    (change: Partial<CharacterInking>) =>
      update((current) => ({
        builtinMods: {
          ...current.builtinMods,
          characterInking: { ...inkingOf(current), ...change },
        },
      })),
    [update],
  );
}
