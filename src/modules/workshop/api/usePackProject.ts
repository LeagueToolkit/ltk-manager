import { useMutation } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

/** Pack a workshop project to `.modpkg` or `.fantome`. */
export function usePackProject() {
  return useMutation(projectMutations.pack());
}
