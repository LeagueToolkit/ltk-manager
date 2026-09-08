import { lazy } from "react";

/** The log console, in a chunk a production launch never asks for. */
export const DevConsoleLazy = lazy(() =>
  import("./DevConsole").then((m) => ({ default: m.DevConsole })),
);
