import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { libraryKeys } from "./keys";
import { profileMutations } from "./profileMutations";

/** Switch to a different profile, and land the reader back on the library. */
export function useSwitchProfile() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /* The navigation is this caller's, so it wraps the shared invalidation rather
     than living inside it. */
  return useMutation({
    ...profileMutations.switchTo(queryClient),
    onSuccess: () => {
      navigate({ to: "/mods" });
      queryClient.invalidateQueries({ queryKey: libraryKeys.activeProfile() });
      queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });
    },
  });
}
