import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback } from "react";

import { api } from "@/lib/tauri";
import { useUpdaterStore } from "@/stores";

/** Download the update a check found, install it, and relaunch into it. */
export function useInstallUpdate() {
  const update = useUpdaterStore((s) => s.update);
  const startInstall = useUpdaterStore((s) => s.startInstall);
  const reportProgress = useUpdaterStore((s) => s.reportProgress);
  const failInstall = useUpdaterStore((s) => s.failInstall);

  return useCallback(async () => {
    if (!update) return;

    startInstall();

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.download((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              reportProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            reportProgress(100);
            break;
        }
      });

      await api.prepareForUpdate();
      await update.install();
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      console.error("Update installation failed:", message);
      failInstall(message);
    }
  }, [failInstall, reportProgress, startInstall, update]);
}
