import { useAppInfo } from "@/modules/settings";

import { isAfter, useHomeStore } from "../state";
import { newestPostAt, useAnnouncements } from "./useAnnouncements";
import { useNotices } from "./useNotices";

/**
 * Whether Home holds something the reader has not seen, for the dot on its tab.
 *
 * The installed version is compared to the one kept locally, so the dot for
 * "the app updated" lights with no network. A notice stays unread until it is
 * dismissed, and a post until Home has been opened over it.
 */
export function useHomeUnread(): boolean {
  const { data: appInfo } = useAppInfo();
  const { data: notices } = useNotices();
  const { data: posts } = useAnnouncements();
  const seenVersion = useHomeStore((s) => s.seenVersion);
  const seenPostAt = useHomeStore((s) => s.seenPostAt);
  const dismissedNoticeIds = useHomeStore((s) => s.dismissedNoticeIds);

  if (appInfo && appInfo.version !== seenVersion) return true;
  if (notices?.some((notice) => !dismissedNoticeIds.includes(notice.id))) return true;

  const newest = newestPostAt(posts);
  return newest !== null && isAfter(newest, seenPostAt);
}
