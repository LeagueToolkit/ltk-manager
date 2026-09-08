import { useEffect } from "react";

import { useAppInfo } from "@/modules/settings";

import { useHomeStore } from "../state";
import { newestPostAt, useAnnouncements } from "./useAnnouncements";

/** Home marks what it shows as seen, on mount and again as the feeds answer while it is up. */
export function useMarkHomeSeen(): void {
  const { data: appInfo } = useAppInfo();
  const { data: posts } = useAnnouncements();
  const markVersionSeen = useHomeStore((s) => s.markVersionSeen);
  const markPostSeen = useHomeStore((s) => s.markPostSeen);

  const version = appInfo?.version;
  useEffect(() => {
    if (version) markVersionSeen(version);
  }, [version, markVersionSeen]);

  const newest = newestPostAt(posts);
  useEffect(() => {
    if (newest) markPostSeen(newest);
  }, [newest, markPostSeen]);
}
