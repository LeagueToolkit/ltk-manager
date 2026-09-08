import { check } from "@tauri-apps/plugin-updater";
import { useCallback } from "react";

import { useUpdaterStore } from "@/stores";

/** Ask the update server what it has, and hand the answer to the store. */
export function useCheckForUpdate() {
  const startCheck = useUpdaterStore((s) => s.startCheck);
  const reportCheck = useUpdaterStore((s) => s.reportCheck);
  const failCheck = useUpdaterStore((s) => s.failCheck);

  return useCallback(async () => {
    startCheck();

    try {
      reportCheck((await check()) ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update check failed";
      console.error("Update check failed:", message);
      failCheck(message);
    }
  }, [failCheck, reportCheck, startCheck]);
}
