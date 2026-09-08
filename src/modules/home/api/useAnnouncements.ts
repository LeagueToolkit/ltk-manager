import { useQuery } from "@tanstack/react-query";

import { type Announcement, api, type AppError } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { isAfter } from "../state";
import { homeKeys } from "./keys";

/** Half an hour, because a post is news for longer than that. */
const FEED_STALE_MS = 30 * 60 * 1000;

/** The project's newest announcements, newest first. */
export function useAnnouncements() {
  return useQuery<Announcement[], AppError>({
    queryKey: homeKeys.announcements(),
    queryFn: queryFn(api.listAnnouncements),
    staleTime: FEED_STALE_MS,
    retry: 1,
  });
}

/** When the newest of `posts` went up, or `null` with no dated post among them. */
export function newestPostAt(posts: Announcement[] | undefined): string | null {
  let newest: string | null = null;
  for (const post of posts ?? []) {
    if (post.publishedAt && isAfter(post.publishedAt, newest)) newest = post.publishedAt;
  }
  return newest;
}
