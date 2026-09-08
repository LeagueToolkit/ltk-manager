import { useMutation } from "@tanstack/react-query";

import { projectImportMutations } from "./mutations";

/** Read what a `.fantome` holds, without unpacking it. */
export function usePeekFantome() {
  return useMutation(projectImportMutations.peekFantome());
}
