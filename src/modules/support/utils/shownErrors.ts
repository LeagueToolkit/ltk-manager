import type { ShownError } from "@/lib/tauri";
import type { Notification } from "@/stores";

/**
 * Returns the backend errors among `notifications` as a report states them, oldest first.
 *
 * `notifications` is newest first, as the notification center holds them. Leaves out a
 * notification that reports no backend error.
 */
export function shownErrors(notifications: readonly Notification[]): ShownError[] {
  return notifications
    .flatMap(({ title, error }) =>
      error ? [{ title, code: error.code, kind: error.kind, ref: error.ref }] : [],
    )
    .reverse();
}
