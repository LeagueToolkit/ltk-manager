import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectImportMutations } from "./mutations";

/** Import a `.fantome` as a new workshop project. */
export function useImportFromFantome() {
  return useMutation(projectImportMutations.fromFantome(useQueryClient()));
}
