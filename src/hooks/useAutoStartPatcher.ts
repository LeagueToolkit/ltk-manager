import { useEffect, useRef } from "react";

import { useStartPatcher } from "@/modules/patcher/api";
import { useSettings } from "@/modules/settings";

export function useAutoStartPatcher() {
  const { data: settings } = useSettings();
  const startPatcher = useStartPatcher();
  const startPatcherRef = useRef(startPatcher);
  startPatcherRef.current = startPatcher;
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || !settings?.alwaysStartPatcher) return;
    hasStarted.current = true;
    startPatcherRef.current.mutate({});
  }, [settings?.alwaysStartPatcher]);
}
