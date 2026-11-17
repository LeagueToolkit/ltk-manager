import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ShownAdvisory } from "@/lib/tauri";

import { advisoryMutations } from "./mutations";
import { diagnosticsQueries } from "./queries";

const NONE: readonly ShownAdvisory[] = [];

/** The advisories of the last build and of the newest game, muted ones included. */
export function useAdvisories() {
  return useQuery(diagnosticsQueries.advisories());
}

/**
 * The advisories that the status bar and the cards show, which are the ones that the user
 * did not mute. Empty until the list loads.
 */
export function useShownAdvisories(): readonly ShownAdvisory[] {
  const { data } = useQuery({ ...diagnosticsQueries.advisories(), select: withoutMuted });
  return data ?? NONE;
}

/** Mutes one advisory code for one mod, optimistically. */
export function useMuteAdvisory() {
  return useMutation(advisoryMutations.mute(useQueryClient()));
}

function withoutMuted(advisories: ShownAdvisory[]): ShownAdvisory[] {
  return advisories.filter((advisory) => !advisory.muted);
}
