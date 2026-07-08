import { useEffect, useRef } from "react";

import { useGuardedStartPatcher } from "@/modules/patcher";
import { useSettings } from "@/modules/settings";

import { useHddWarning } from "./useHddWarning";

export function useAutoStartPatcher() {
  const { data: settings } = useSettings();
  const { start: guardedStart } = useGuardedStartPatcher();
  const maybeShowHddWarning = useHddWarning();

  const guardedStartRef = useRef(guardedStart);
  guardedStartRef.current = guardedStart;

  const maybeShowHddWarningRef = useRef(maybeShowHddWarning);
  maybeShowHddWarningRef.current = maybeShowHddWarning;

  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || !settings?.alwaysStartPatcher) return;
    hasStarted.current = true;

    (async () => {
      await maybeShowHddWarningRef.current();
      await guardedStartRef.current({});
    })();
  }, [settings?.alwaysStartPatcher]);
}
