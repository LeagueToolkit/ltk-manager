import { useCallback } from "react";

import { useToast } from "@/components";
import { api, isOk } from "@/lib/tauri";
import { useSaveSettings, useSettings } from "@/modules/settings";

/**
 * Returns a callback that, when invoked, checks whether the user's League
 * install or mod storage lives on a spinning HDD and — if so, and the user
 * hasn't already been warned — shows a one-time warning toast.
 *
 * The flag is only persisted when the warning is actually displayed, so
 * users who configure League later still see it on their first real build.
 * Silent no-op on non-Windows platforms (detection returns `"unknown"`).
 */
export function useHddWarning() {
  const toast = useToast();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  return useCallback(async () => {
    if (!settings || settings.hasSeenHddWarning) return;

    const pathsToCheck: string[] = [];
    if (settings.leaguePath) pathsToCheck.push(settings.leaguePath);

    const storageDirResult = await api.getStorageDirectory();
    if (isOk(storageDirResult) && storageDirResult.value) {
      pathsToCheck.push(storageDirResult.value);
    }

    if (pathsToCheck.length === 0) return;

    let isOnHdd = false;
    for (const path of pathsToCheck) {
      const result = await api.detectStorageMedium(path);
      if (isOk(result) && result.value === "hdd") {
        isOnHdd = true;
        break;
      }
    }

    if (!isOnHdd) return;

    toast.toast({
      title: "League is on an HDD",
      description:
        "First mod build may take 15–20 minutes. Later builds only repatch what changed. For best performance, move League to an SSD.",
      type: "warning",
      timeout: 15000,
    });

    saveSettings.mutate({ ...settings, hasSeenHddWarning: true });
  }, [settings, toast, saveSettings]);
}
