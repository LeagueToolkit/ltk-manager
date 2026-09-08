import { queryOptions } from "@tanstack/react-query";

import { type Announcement, api, type AppError, type Notice } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { homeKeys } from "./keys";

/** Half an hour: how quickly a notice the project publishes reaches a running app. */
const FEED_STALE_MS = 30 * 60 * 1000;

/** What the project publishes to the home page. */
export const homeQueries = {
  /** The notices that concern this build right now, newest first. */
  notices: () =>
    queryOptions<Notice[], AppError>({
      queryKey: homeKeys.notices(),
      queryFn: queryFn(api.listNotices),
      staleTime: FEED_STALE_MS,
      retry: 1,
    }),

  /** The project's newest announcements, newest first. */
  announcements: () =>
    queryOptions<Announcement[], AppError>({
      queryKey: homeKeys.announcements(),
      queryFn: queryFn(api.listAnnouncements),
      staleTime: FEED_STALE_MS,
      retry: 1,
    }),
} as const;
