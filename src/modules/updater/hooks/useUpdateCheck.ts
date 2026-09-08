import { useEffect } from "react";

import { useUpdaterStore } from "@/stores";

import { useCheckForUpdate } from "../api";
import { mockUpdate } from "../mockUpdate";

/**
 * Check for an update shortly after the app mounts.
 *
 * A dev run with `VITE_MOCK_UPDATE=1` gets a stand-in update instead, to
 * exercise the titlebar cell and the changelog dialog.
 */
export function useUpdateCheck({ checkOnMount = true, delayMs = 3000 } = {}) {
  const checkForUpdate = useCheckForUpdate();

  useEffect(() => {
    if (import.meta.env.DEV) {
      if (import.meta.env.VITE_MOCK_UPDATE === "1") {
        useUpdaterStore.setState({ update: mockUpdate() });
      }
      return;
    }
    if (!checkOnMount) return;

    const timeoutId = setTimeout(() => {
      checkForUpdate();
    }, delayMs);

    return () => clearTimeout(timeoutId);
  }, [checkOnMount, delayMs, checkForUpdate]);
}
