import { useQuery } from "@tanstack/react-query";

import { launcherQueries } from "./queries";

/** Whether a launch is possible right now. */
export function useLaunchAvailability() {
  return useQuery(launcherQueries.availability());
}
