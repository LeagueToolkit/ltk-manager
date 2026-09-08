import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cslolMutations } from "./mutations";

export type { ImportCslolModsVariables } from "./mutations";

/** Bring the chosen CSLOL folders into the library. */
export function useImportCslolMods() {
  return useMutation(cslolMutations.importMods(useQueryClient()));
}
