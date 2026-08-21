import { create } from "zustand";

import type { Incident } from "@/lib/tauri";

interface IncidentLineStore {
  /** The incident the session bar's verdict line speaks for. */
  incident: Incident | null;
  /**
   * The incident a later clean game has answered. Its suspect badges come down,
   * because a mod that was in a clean game after the crash has answered the
   * question, and a badge that stays would be an accusation.
   */
  answeredIncidentId: string | null;
  show: (incident: Incident) => void;
  /** Clears the line when it speaks for `id`, or unconditionally without one. */
  clear: (id?: string) => void;
  markAnswered: (id: string) => void;
}

/**
 * The verdict line's state: the incident that arrived last, until the user
 * closes it or the next game starts. The list itself is the `useIncidents`
 * query, which this store never duplicates.
 */
export const useIncidentLineStore = create<IncidentLineStore>((set) => ({
  incident: null,
  answeredIncidentId: null,
  show: (incident) => set({ incident }),
  clear: (id) =>
    set((state) => {
      if (id !== undefined && state.incident?.id !== id) return state;
      return { incident: null };
    }),
  markAnswered: (id) => set({ answeredIncidentId: id }),
}));
