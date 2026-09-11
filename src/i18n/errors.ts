import { match } from "ts-pattern";

import type {
  AppError,
  InjectionStage,
  LauncherError,
  OverlayErrorCategory,
  PatcherError,
  WorkshopError,
} from "@/lib/bindings";
import { m } from "@/paraglide/messages";
import { isAppError } from "@/utils/errors";

/** The copy for one error: what went wrong, the remedy, and any prose from outside the app. */
export interface ErrorCopy {
  title: string;
  description?: string;
  /** Prose from outside the app, drawn as data with `select-text`. */
  detail?: string;
}

/** The copy for a backend error, exhaustive over its `code` so a new variant fails `tsc`. */
export function describeError(error: AppError): ErrorCopy {
  return match(error)
    .with({ code: "IO" }, (e) => withDetail(m["error.IO.title"](), e.detail))
    .with({ code: "SERIALIZATION" }, (e) => withDetail(m["error.SERIALIZATION.title"](), e.detail))
    .with({ code: "MODPKG" }, (e) => withDetail(m["error.MODPKG.title"](), e.detail))
    .with({ code: "LEAGUE_NOT_FOUND" }, () => ({
      title: m["error.LEAGUE_NOT_FOUND.title"](),
      description: m["error.LEAGUE_NOT_FOUND.description"](),
    }))
    .with({ code: "INVALID_PATH" }, ({ path }) => ({
      title: m["error.INVALID_PATH.title"]({ path }),
    }))
    .with({ code: "MOD_NOT_FOUND" }, ({ modId }) => ({
      title: m["error.MOD_NOT_FOUND.title"]({ modId }),
    }))
    .with({ code: "VALIDATION_FAILED" }, (e) =>
      withDetail(m["error.VALIDATION_FAILED.title"](), e.detail),
    )
    .with({ code: "INTERNAL_STATE" }, (e) =>
      withDetail(m["error.INTERNAL_STATE.title"](), e.detail),
    )
    .with({ code: "UNKNOWN" }, (e) => withDetail(m["error.UNKNOWN.title"](), e.detail))
    .with({ code: "WORKSHOP_NOT_CONFIGURED" }, () => ({
      title: m["error.WORKSHOP_NOT_CONFIGURED.title"](),
    }))
    .with({ code: "PROJECT_NOT_FOUND" }, ({ projectName }) => ({
      title: m["error.PROJECT_NOT_FOUND.title"]({ projectName }),
    }))
    .with({ code: "PROJECT_ALREADY_EXISTS" }, ({ projectName }) => ({
      title: m["error.PROJECT_ALREADY_EXISTS.title"]({ projectName }),
    }))
    .with({ code: "PACK_FAILED" }, (e) => withDetail(m["error.PACK_FAILED.title"](), e.detail))
    .with({ code: "FANTOME" }, (e) => withDetail(m["error.FANTOME.title"](), e.detail))
    .with({ code: "WAD" }, (e) => withDetail(m["error.WAD.title"](), e.detail))
    .with({ code: "PATCHER" }, ({ error }) => describePatcherError(error))
    .with({ code: "ZIP" }, (e) => withDetail(m["error.ZIP.title"](), e.detail))
    .with({ code: "SCHEMA_VERSION_TOO_NEW" }, ({ fileVersion, maxSupported }) => ({
      title: m["error.SCHEMA_VERSION_TOO_NEW.title"](),
      description: m["error.SCHEMA_VERSION_TOO_NEW.description"]({ fileVersion, maxSupported }),
    }))
    .with({ code: "WORKSHOP" }, ({ error }) => describeWorkshopError(error))
    .with({ code: "LAUNCHER" }, ({ error }) => describeLaunchError(error))
    .with({ code: "HASHTABLE" }, (e) => withDetail(m["error.HASHTABLE.title"](), e.detail))
    .with({ code: "PREVIEW" }, (e) => withDetail(m["error.PREVIEW.title"](), e.detail))
    .with({ code: "BIN_UNREADABLE" }, (e) =>
      withDetail(m["error.BIN_UNREADABLE.title"](), e.detail),
    )
    .with({ code: "BIN_NOT_OPEN" }, () => ({ title: m["error.BIN_NOT_OPEN.title"]() }))
    .with({ code: "BIN_NODE_NOT_FOUND" }, ({ address }) => ({
      title: m["error.BIN_NODE_NOT_FOUND.title"]({ address }),
    }))
    .with({ code: "BIN_READ_TOO_WIDE" }, ({ rows, cap }) => ({
      title: m["error.BIN_READ_TOO_WIDE.title"](),
      description: m["error.BIN_READ_TOO_WIDE.description"]({ rows, cap }),
    }))
    .with({ code: "BIN_READ_TOO_LARGE" }, () => ({
      title: m["error.BIN_READ_TOO_LARGE.title"](),
      description: m["error.BIN_READ_TOO_LARGE.description"](),
    }))
    .with({ code: "BIN_READ_TOO_DEEP" }, () => ({
      title: m["error.BIN_READ_TOO_DEEP.title"](),
      description: m["error.BIN_READ_TOO_DEEP.description"](),
    }))
    .with({ code: "OVERLAY" }, ({ category, detail }) => withDetail(overlayTitle(category), detail))
    .with({ code: "UNTRUSTED_DOMAIN" }, ({ domain }) => ({
      title: m["error.UNTRUSTED_DOMAIN.title"]({ domain }),
      description: m["error.UNTRUSTED_DOMAIN.description"](),
    }))
    .with({ code: "GITHUB" }, (e) => describeGitHubError(e))
    .exhaustive();
}

/** One line for a slot with no title of its own: the outside detail, else the remedy, else the title. */
export function errorSummary(error: AppError): string {
  const copy = describeError(error);
  return copy.detail ?? copy.description ?? copy.title;
}

function withDetail(title: string, detail: string): ErrorCopy {
  return { title, detail };
}

/** The category's own title, so a wrong game dir does not read as a broken mod. */
function overlayTitle(category: OverlayErrorCategory): string {
  return match(category)
    .with("GAME_DIR", () => m["error.OVERLAY.GAME_DIR.title"]())
    .with("MOD_CONTENT", () => m["error.OVERLAY.MOD_CONTENT.title"]())
    .with("WAD_LIMIT", () => m["error.OVERLAY.WAD_LIMIT.title"]())
    .with("CORRUPT", () => m["error.OVERLAY.CORRUPT.title"]())
    .with("BUG", () => m["error.OVERLAY.BUG.title"]())
    .with("OTHER", () => m["error.OVERLAY.title"]())
    .exhaustive();
}

/** The copy for something GitHub publishes going unread, each kind with its own remedy. */
function describeGitHubError({ kind, detail }: Extract<AppError, { code: "GITHUB" }>): ErrorCopy {
  const copy = match(kind)
    .with("OFFLINE", () => ({
      title: m["error.GITHUB.OFFLINE.title"](),
      description: m["error.GITHUB.OFFLINE.description"](),
    }))
    .with("RATE_LIMITED", () => ({
      title: m["error.GITHUB.RATE_LIMITED.title"](),
      description: m["error.GITHUB.RATE_LIMITED.description"](),
    }))
    .with("HTTP", () => ({
      title: m["error.GITHUB.HTTP.title"](),
      description: m["error.GITHUB.HTTP.description"](),
    }))
    .exhaustive();
  return { ...copy, detail };
}

/** The copy for a launch failure, each kind with its remedy, per "Launch failures" in docs/ux/LAUNCHER.md. */
export function describeLaunchError(error: LauncherError): ErrorCopy {
  return (
    match(error)
      .with({ kind: "RIOT_CLIENT_NOT_FOUND" }, () => ({
        title: m["launcher.RIOT_CLIENT_NOT_FOUND.title"](),
        description: m["launcher.RIOT_CLIENT_NOT_FOUND.description"](),
      }))
      .with({ kind: "RIOT_CLIENT_UNREACHABLE" }, ({ reason }) => ({
        title: m["launcher.RIOT_CLIENT_UNREACHABLE.title"](),
        description: m["launcher.RIOT_CLIENT_UNREACHABLE.description"](),
        detail: reason,
      }))
      .with({ kind: "REFUSED" }, (refusal) => describeRefusal(refusal))
      // Never shown: a cancel is the user's own doing and `useLaunchErrorToast` stays silent on it.
      .with({ kind: "STOPPED" }, () => ({ title: m.launcher_launch_failed_title() }))
      .with({ kind: "MISCONFIGURED" }, ({ reason }) =>
        withDetail(m["launcher.MISCONFIGURED.title"](), reason),
      )
      .with({ kind: "SPAWN_FAILED" }, ({ reason }) => ({
        title: m["launcher.SPAWN_FAILED.title"](),
        description: m["launcher.SPAWN_FAILED.description"](),
        detail: reason,
      }))
      .with({ kind: "UNSUPPORTED_PLATFORM" }, () => ({
        title: m["launcher.UNSUPPORTED_PLATFORM.title"](),
        description: m["launcher.UNSUPPORTED_PLATFORM.description"](),
      }))
      .with({ kind: "OTHER" }, ({ message }) =>
        withDetail(m.launcher_launch_failed_title(), message),
      )
      .exhaustive()
  );
}

/** A refusal this build has words for gets them, and any other keeps Riot's own prose as data. */
function describeRefusal(refusal: Extract<LauncherError, { kind: "REFUSED" }>): ErrorCopy {
  if (refusal.riotErrorCode === "eula_not_accepted") {
    return {
      title: m["launcher.REFUSED.eula_not_accepted.title"](),
      description: m["launcher.REFUSED.eula_not_accepted.description"](),
    };
  }
  return withDetail(m["launcher.REFUSED.title"](), refusal.message);
}

/** The copy for a patcher refusal or a failed start. */
export function describePatcherError(error: PatcherError): ErrorCopy {
  return match(error)
    .with({ kind: "BUSY" }, () => ({ title: m["patcher.BUSY.title"]() }))
    .with({ kind: "ALREADY_RUNNING" }, () => ({ title: m["patcher.ALREADY_RUNNING.title"]() }))
    .with({ kind: "NOT_RUNNING" }, () => ({ title: m["patcher.NOT_RUNNING.title"]() }))
    .with({ kind: "UNSUPPORTED_PLATFORM" }, () => ({
      title: m["patcher.UNSUPPORTED_PLATFORM.title"](),
    }))
    .with({ kind: "INJECTION_FAILED" }, ({ stage, message }) =>
      withDetail(injectionStageTitle(stage), message),
    )
    .exhaustive();
}

/** The failed-start title for an injection stage, in the words the verdict uses. */
export function injectionStageTitle(stage: InjectionStage): string {
  return match(stage)
    .with("HOST", () => m["patcher.INJECTION_FAILED.HOST.title"]())
    .with("INJECTION", () => m["patcher.INJECTION_FAILED.INJECTION.title"]())
    .exhaustive();
}

/** The copy for a workshop failure. */
export function describeWorkshopError(error: WorkshopError): ErrorCopy {
  return match(error)
    .with({ kind: "LAYER_FILE_CONFLICT" }, ({ conflicts }) => ({
      title: m["workshop.LAYER_FILE_CONFLICT.title"](),
      ...(conflicts.length > 0 && { description: conflictSentence(conflicts) }),
    }))
    .exhaustive();
}

/** Up to three names in full, and past that two names and a count. */
function conflictSentence(conflicts: string[]): string {
  const shown = conflicts.length > 3 ? conflicts.slice(0, 2) : conflicts;
  return m["workshop.LAYER_FILE_CONFLICT.description"]({
    names: shown.join(", "),
    count: conflicts.length,
    more: conflicts.length - shown.length,
  });
}

/** One line for a thrown value: a backend error's summary, an `Error`'s message, else nothing known. */
export function errorMessage(error: unknown): string {
  if (isAppError(error)) return errorSummary(error);
  if (error instanceof Error) return error.message;
  return m.common_unknown_error_label();
}
