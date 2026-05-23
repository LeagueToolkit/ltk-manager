import { useEffect, useRef } from "react";

import { useStartPatcher } from "@/modules/patcher/api";
import { useSettings } from "@/modules/settings";

import { useHddWarning } from "./useHddWarning";

export function useAutoStartPatcher() {
  const { data: settings } = useSettings();
  const startPatcher = useStartPatcher();
  const maybeShowHddWarning = useHddWarning();

  const startPatcherRef = useRef(startPatcher);
  startPatcherRef.current = startPatcher;

  const maybeShowHddWarningRef = useRef(maybeShowHddWarning);
  maybeShowHddWarningRef.current = maybeShowHddWarning;

  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || !settings?.alwaysStartPatcher) return;
    hasStarted.current = true;

    (async () => {
      await maybeShowHddWarningRef.current();
      startPatcherRef.current.mutate({});
    })();
  }, [settings?.alwaysStartPatcher]);
}
