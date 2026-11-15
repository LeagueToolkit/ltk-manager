import { useCallback } from "react";

import { useToast } from "@/components";
import { describeLaunchError, type ErrorCopy, errorSummary, m } from "@/i18n";
import type { AppError } from "@/lib/tauri";

/** A launch can also fail before the launcher is reached, and that failure keeps the launch's framing. */
function launchErrorCopy(error: AppError): ErrorCopy {
  if (error.code === "LAUNCHER") return describeLaunchError(error.error);
  return { title: m.launcher_launch_failed_title(), detail: errorSummary(error) };
}

/**
 * Returns a callback that surfaces a launch failure with the right wording.
 *
 * A cancelled launch is silent. It arrives here because it is a `LauncherError`
 * like any other, but nothing failed, and a dialog saying the launch broke,
 * behind a Cancel button the user just pressed, is worse than saying nothing.
 */
export function useLaunchErrorToast() {
  const toast = useToast();

  return useCallback(
    (error: AppError) => {
      if (error.code === "LAUNCHER" && error.error.kind === "STOPPED") return;

      const { title, description, detail } = launchErrorCopy(error);
      toast.failure(title, error, { description: description ?? detail });
      console.error("Failed to launch League:", error);
    },
    [toast],
  );
}
