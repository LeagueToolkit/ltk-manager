import { lazy } from "react";

/** The install-list dialog, in a chunk the shell does not block on. */
export const InstallListDialogLazy = lazy(() =>
  import("./InstallListDialog").then((m) => ({ default: m.InstallListDialog })),
);
