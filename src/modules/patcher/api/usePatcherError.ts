import { useNavigate } from "@tanstack/react-router";

import { useToast } from "@/components/Toast";
import { describeError, errorSummary, injectionStageTitle, m } from "@/i18n";
import type { AppError } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { type PatcherFailure, type PatcherFailureStage, usePatcherFailureStore } from "@/stores";

/** The failed-start line's title for a stage, in the words the verdict uses. */
export function patcherFailureTitle(stage: PatcherFailureStage): string {
  return stage === "BUILD" ? m["error.OVERLAY.title"]() : injectionStageTitle(stage);
}

/**
 * Which Diagnostics tab answers a stage.
 *
 * A host that did not start is what the System checks look for: antivirus or a
 * missing binary. Anything later is the incident's.
 */
export function patcherFailureTab(stage: PatcherFailureStage): "games" | "system" {
  return stage === "HOST" ? "system" : "games";
}

/**
 * The start failure a `patcher-error` carries, or `null` when it failed nothing.
 *
 * The thread reports on this event from two places only. The session sends
 * `InjectionFailed` with its stage, and the overlay build sends the builder's
 * own error as it is, under whatever code the builder raised. A `PATCHER` error
 * of any other kind is a refusal such as `BUSY`, which no start failed on.
 */
export function classifyPatcherError(error: AppError): PatcherFailure | null {
  if (error.code === "PATCHER") {
    if (error.error.kind !== "INJECTION_FAILED") return null;
    return { stage: error.error.stage, message: error.error.message };
  }
  return {
    stage: "BUILD",
    message: errorSummary(error),
    ...(error.code === "OVERLAY" && { title: describeError(error).title }),
  };
}

/**
 * Every `patcher-error`, as a toast and the session bar's failed-start line.
 *
 * Mounted once at the root, so a failure during a workshop test or under the
 * settings page reaches the user the same as one on the Library.
 */
export function usePatcherError() {
  const toast = useToast();
  const navigate = useNavigate();
  const setFailure = usePatcherFailureStore((s) => s.set);

  useTauriEvent<AppError>("patcher-error", (error) => {
    const failure = classifyPatcherError(error);
    if (failure) setFailure(failure);

    if (!failure || failure.stage === "BUILD") {
      toast.error(failure?.title ?? m.patcher_error_title(), errorSummary(error), { notify: true });
      return;
    }

    const tab = patcherFailureTab(failure.stage);
    toast.toast({
      type: "error",
      title: patcherFailureTitle(failure.stage),
      description: failure.message,
      timeout: 7000,
      notify: true,
      action: {
        label: tab === "system" ? "Diagnostics" : "Details",
        onClick: () => navigate({ to: "/diagnostics", search: { tab } }),
      },
    });
  });
}
