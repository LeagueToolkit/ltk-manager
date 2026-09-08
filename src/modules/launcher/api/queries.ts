import { queryOptions } from "@tanstack/react-query";

import { api, type AppError, type LaunchAvailability, type SessionStarted } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { launcherKeys } from "./keys";

/** A backstop for the Riot Client being opened or closed on its own. */
const POLL_INTERVAL_MS = 30_000;

/** What the Riot Client answers about launching and about the session it is running. */
export const launcherQueries = {
  /* Asked once, because a session in progress announced itself before this webview
     existed. Everything after that arrives as an event. */
  session: () =>
    queryOptions<SessionStarted | null, AppError>({
      queryKey: launcherKeys.session(),
      queryFn: queryFn(api.getLeagueSession),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }),

  /* Half of the answer - whether League is up - arrives as a session event, and
     `useLeagueSession` refetches this the moment one starts or ends. The poll left
     behind covers only the other half, so it can be slow. */
  availability: () =>
    queryOptions<LaunchAvailability, AppError>({
      queryKey: launcherKeys.availability(),
      queryFn: queryFn(api.getLaunchAvailability),
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }),
} as const;
