import { useMutation, useQueryClient } from "@tanstack/react-query";

import { profileMutations } from "./profileMutations";

/** Delete a profile. */
export function useDeleteProfile() {
  return useMutation(profileMutations.remove(useQueryClient()));
}
