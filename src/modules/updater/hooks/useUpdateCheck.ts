import { useEffect } from "react";

import { useTauriEvent } from "@/lib/useTauriEvent";
import { useUpdaterSetDialogOpen, useUpdaterStore } from "@/stores";

import { downloadUpdate, useCheckForUpdate } from "../api";
import { MOCK_UPDATE } from "../mockUpdate";

/** Between two checks of a running app, which can sit in the tray for days. */
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** How old a check is before the window coming back into view asks again. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** Emitted by the tray's update entry. */
const REQUESTED_EVENT = "update-requested";

/**
 * Keep the app's update current for as long as it runs, mounted once at the root.
 *
 * - Checks shortly after mount, on an interval, and when the window comes back
 *   into view after a stale check
 * - With `autoDownload`, downloads a release the reader has not skipped, so
 *   installing is a restart and quitting installs it
 * - Opens the dialog when the tray's update entry is pressed
 *
 * A dev run checks nothing, and with `VITE_MOCK_UPDATE=1` it gets a stand-in
 * update instead, to exercise the titlebar cell and the changelog dialog.
 */
export function useUpdateCheck({ delayMs = 3000, autoDownload = false } = {}) {
  const checkForUpdate = useCheckForUpdate();
  const setDialogOpen = useUpdaterSetDialogOpen();
  const version = useUpdaterStore((s) => s.update?.version);
  const skipped = useUpdaterStore((s) => s.skippedVersion !== null && s.skippedVersion === version);

  useTauriEvent<null>(REQUESTED_EVENT, () => setDialogOpen(true));

  useEffect(() => {
    if (autoDownload && version && !skipped) void downloadUpdate();
  }, [autoDownload, version, skipped]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      if (import.meta.env.VITE_MOCK_UPDATE === "1") {
        useUpdaterStore.setState({ update: MOCK_UPDATE });
      }
      return;
    }

    const onVisible = () => {
      const { checkedAt } = useUpdaterStore.getState();
      const stale = checkedAt !== null && Date.now() - checkedAt > STALE_AFTER_MS;
      if (document.visibilityState === "visible" && stale) void checkForUpdate();
    };

    const first = setTimeout(checkForUpdate, delayMs);
    const recheck = setInterval(checkForUpdate, RECHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [delayMs, checkForUpdate]);
}
