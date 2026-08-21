import { createFileRoute } from "@tanstack/react-router";

import { Diagnostics } from "../pages/Diagnostics";

export type DiagnosticsTab = "games" | "system";

export interface DiagnosticsSearch {
  /** Absent means the Games tab. */
  tab?: DiagnosticsTab;
  /** The incident the Games tab opens on. */
  incident?: string;
}

export const Route = createFileRoute("/diagnostics")({
  validateSearch: (search: Record<string, unknown>): DiagnosticsSearch => {
    return {
      tab: search.tab === "system" ? "system" : search.tab === "games" ? "games" : undefined,
      incident: typeof search.incident === "string" ? search.incident : undefined,
    };
  },
  component: Diagnostics,
});
