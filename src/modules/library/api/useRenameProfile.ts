import { useMutation, useQueryClient } from "@tanstack/react-query";

import { profileMutations } from "./profileMutations";

export type { RenameProfileVariables } from "./profileMutations";

/** Rename a profile. */
export function useRenameProfile() {
  return useMutation(profileMutations.rename(useQueryClient()));
}
