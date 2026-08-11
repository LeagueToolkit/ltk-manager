import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { libraryKeys } from "./keys";

export function useFetchModThumbnail(modId: string) {
  const queryClient = useQueryClient();

  return useMutation<string | null, AppError, void>({
    mutationFn: mutationFn(() => api.fetchModThumbnail(modId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.thumbnail(modId) });
    },
  });
}
