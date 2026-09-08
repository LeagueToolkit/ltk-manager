import { lazy } from "react";

/** The update dialog, in a chunk the shell does not block on. */
export const UpdateNotificationLazy = lazy(() =>
  import("./UpdateNotification").then((m) => ({ default: m.UpdateNotification })),
);
