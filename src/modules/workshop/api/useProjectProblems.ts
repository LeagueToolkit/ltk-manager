import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/**
 * Every problem one run found in a project.
 *
 * The run starts as soon as a path arrives and a user asks for nothing,
 * because a modder who has to press a button to learn their mod is broken
 * learns it from the game instead. The backend answers a large real project in
 * around 260ms, so there is no progress to report and nothing to gate on.
 */
export function useProjectProblems(projectPath: string | undefined) {
  return useQuery(projectQueries.problems(projectPath));
}
