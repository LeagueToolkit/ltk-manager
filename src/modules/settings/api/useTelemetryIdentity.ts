import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

/** The pseudonym today's diagnostics travel under, or null when none are collected. */
export function useTelemetryIdentity() {
  return useQuery(settingsQueries.telemetryIdentity());
}
