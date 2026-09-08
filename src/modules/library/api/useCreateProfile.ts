import { useMutation, useQueryClient } from "@tanstack/react-query";

import { profileMutations } from "./profileMutations";

/** Create a new profile. */
export function useCreateProfile() {
  return useMutation(profileMutations.create(useQueryClient()));
}
