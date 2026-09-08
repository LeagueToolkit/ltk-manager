import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectImportMutations } from "./mutations";

/** Import a `.modpkg` as a new workshop project. */
export function useImportFromModpkg() {
  return useMutation(projectImportMutations.fromModpkg(useQueryClient()));
}
