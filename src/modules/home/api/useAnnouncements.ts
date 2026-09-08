import { useQuery } from "@tanstack/react-query";

import type { Announcement } from "@/lib/tauri";

import { isAfter } from "../state";
import { homeQueries } from "./queries";

/** The project's newest announcements, newest first. */
export function useAnnouncements() {
  return useQuery(homeQueries.announcements());
}

/** When the newest of `posts` went up, or `null` with no dated post among them. */
export function newestPostAt(posts: Announcement[] | undefined): string | null {
  let newest: string | null = null;
  for (const post of posts ?? []) {
    if (post.publishedAt && isAfter(post.publishedAt, newest)) newest = post.publishedAt;
  }
  return newest;
}
