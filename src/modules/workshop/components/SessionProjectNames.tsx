import type { ReactNode } from "react";

import { useSessionProjectNames } from "../api";

/** The names of the session's projects, handed to `children`, for a module outside workshop. */
export function SessionProjectNames({ children }: { children: (names: string[]) => ReactNode }) {
  return children(useSessionProjectNames());
}
