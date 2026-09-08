import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectImportMutations } from "./mutations";

/** Import a git repository as a new workshop project. */
export function useImportFromGitRepo() {
  return useMutation(projectImportMutations.fromGitRepo(useQueryClient()));
}
