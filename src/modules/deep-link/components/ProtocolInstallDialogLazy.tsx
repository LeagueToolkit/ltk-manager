import { lazy } from "react";

/** The install dialog, in a chunk the shell does not block on. */
export const ProtocolInstallDialogLazy = lazy(() =>
  import("./ProtocolInstallDialog").then((m) => ({ default: m.ProtocolInstallDialog })),
);
