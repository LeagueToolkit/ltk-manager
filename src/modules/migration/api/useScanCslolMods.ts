import { useMutation } from "@tanstack/react-query";

import { cslolMutations } from "./mutations";

/** Read what a CSLOL directory holds. */
export function useScanCslolMods() {
  return useMutation(cslolMutations.scan());
}
