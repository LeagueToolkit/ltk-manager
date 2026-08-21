import { useEffect, useState } from "react";

import type { Incident } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useIncidentLineStore } from "@/stores";

import { useLatestIncident } from "./useIncidents";

/**
 * How long after `patcher-game-exited` an incident may still arrive.
 *
 * The record waits up to five seconds for the session's ending and the log
 * reader retries for five more, so fifteen covers both with room for a slow disk.
 */
export const CLEAN_GAME_GRACE_MS = 15_000;

/**
 * Answers the newest undismissed incident when a later game ends clean.
 *
 * The backend records nothing for a game that went right, so a clean game is
 * `patcher-game-exited` with no `incident-recorded` inside the grace period.
 * The incident open when the game ended is the one answered, and its suspect
 * badges come down. An incident that does arrive cancels the wait and is the
 * newest itself.
 */
export function useCleanGameWatch() {
  const { latest } = useLatestIncident();
  const markAnswered = useIncidentLineStore((s) => s.markAnswered);
  const [awaiting, setAwaiting] = useState<string | null>(null);

  useTauriEvent<null>("patcher-game-exited", () => setAwaiting(latest?.id ?? null));
  useTauriEvent<Incident>("incident-recorded", () => setAwaiting(null));

  useEffect(() => {
    if (awaiting === null) return;
    const timer = setTimeout(() => {
      markAnswered(awaiting);
      setAwaiting(null);
    }, CLEAN_GAME_GRACE_MS);
    return () => clearTimeout(timer);
  }, [awaiting, markAnswered]);
}
