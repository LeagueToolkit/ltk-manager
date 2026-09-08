import { create } from "zustand";
import { persist } from "zustand/middleware";

import { keepUnversioned } from "@/stores/storage";

interface HomeStore {
  /** The installed version the reader last opened Home on, `null` before any. */
  seenVersion: string | null;
  /** When the newest post the reader has opened Home over went up, RFC 3339. */
  seenPostAt: string | null;
  /** Notices the reader has closed, which stay closed. */
  dismissedNoticeIds: string[];
  markVersionSeen: (version: string) => void;
  /** Moves the mark forward to `publishedAt`, and never back. */
  markPostSeen: (publishedAt: string) => void;
  dismissNotice: (id: string) => void;
}

/**
 * What Home has shown the reader, so the tab's dot means unread and nothing else.
 *
 * Kept locally, the way the skipped update version is, so the dot for "the app
 * updated" lights with no network.
 */
export const useHomeStore = create<HomeStore>()(
  persist(
    (set) => ({
      seenVersion: null,
      seenPostAt: null,
      dismissedNoticeIds: [],
      markVersionSeen: (version) => set({ seenVersion: version }),
      markPostSeen: (publishedAt) =>
        set((state) =>
          isAfter(publishedAt, state.seenPostAt) ? { seenPostAt: publishedAt } : state,
        ),
      dismissNotice: (id) =>
        set((state) =>
          state.dismissedNoticeIds.includes(id)
            ? state
            : { dismissedNoticeIds: [...state.dismissedNoticeIds, id] },
        ),
    }),
    { name: "ltk-home", version: 1, migrate: keepUnversioned<HomeStore> },
  ),
);

/** Whether `stamp` is later than `mark`, with no mark counting as the beginning of time. */
export function isAfter(stamp: string, mark: string | null): boolean {
  if (mark === null) return true;
  const later = Date.parse(stamp);
  const marked = Date.parse(mark);
  if (Number.isNaN(later) || Number.isNaN(marked)) return false;
  return later > marked;
}
