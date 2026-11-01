import { match } from "ts-pattern";

import type { DownloadError } from "@/lib/tauri";
import { m } from "@/paraglide/messages";

import type { ErrorCopy } from "./errors";

/** The copy for the download an install link starts failing, each kind with its remedy. */
export function describeDownloadError(error: DownloadError): ErrorCopy {
  return match(error)
    .with({ kind: "LINK_EXPIRED" }, () => ({
      title: m["error.DOWNLOAD.LINK_EXPIRED.title"](),
      description: m["error.DOWNLOAD.LINK_EXPIRED.description"](),
    }))
    .with({ kind: "UNAVAILABLE" }, () => ({
      title: m["error.DOWNLOAD.UNAVAILABLE.title"](),
      description: m["error.DOWNLOAD.UNAVAILABLE.description"](),
    }))
    .with({ kind: "FILES_REMOVED" }, () => ({
      title: m["error.DOWNLOAD.FILES_REMOVED.title"](),
      description: m["error.DOWNLOAD.FILES_REMOVED.description"](),
    }))
    .with({ kind: "RATE_LIMITED" }, ({ retryAfter }) => ({
      title: m["error.DOWNLOAD.RATE_LIMITED.title"](),
      description: retryDescription(retryAfter),
    }))
    .with({ kind: "HTTP" }, ({ status }) => ({
      title: m["error.DOWNLOAD.HTTP.title"](),
      description: m["error.DOWNLOAD.HTTP.description"]({ status }),
    }))
    .with({ kind: "OFFLINE" }, ({ detail }) => ({
      title: m["error.DOWNLOAD.OFFLINE.title"](),
      description: m["error.DOWNLOAD.OFFLINE.description"](),
      detail,
    }))
    .exhaustive();
}

/**
 * The wait a rate-limited answer names, in the largest unit that reads whole.
 *
 * The guest daily limit answers with a wait of hours, and the per-minute limit with one of
 * seconds, so one unit fits neither. An answer without `Retry-After` names no wait.
 */
export function retryDescription(retryAfter: number | null): string {
  if (retryAfter === null) return m["error.DOWNLOAD.RATE_LIMITED.description"]();
  if (retryAfter < 120) {
    return m["error.DOWNLOAD.RATE_LIMITED.seconds.description"]({ seconds: retryAfter });
  }
  if (retryAfter < 7200) {
    return m["error.DOWNLOAD.RATE_LIMITED.minutes.description"]({
      minutes: Math.ceil(retryAfter / 60),
    });
  }
  return m["error.DOWNLOAD.RATE_LIMITED.hours.description"]({
    hours: Math.ceil(retryAfter / 3600),
  });
}
