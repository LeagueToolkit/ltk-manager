import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { AppError, WorkshopProject } from "@/lib/tauri";
import { patcherKeys, startPatcherSpendingQueue } from "@/modules/patcher";
import { usePatcherSessionStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { writeBeforeTest } from "../state/beforeTest";
import { testedLayers, useTestLayersStore } from "../state/testLayers";

type TestedProject = Pick<WorkshopProject, "path" | "displayName" | "layers">;

interface TestProjectsArgs {
  projects: TestedProject[];
  includeProfile?: boolean;
}

/** The layers each project is tested with, for the projects that leave some out. */
function workshopLayers(projects: TestedProject[]): Record<string, string[]> | undefined {
  const { excluded } = useTestLayersStore.getState();
  const entries = projects.flatMap((project) => {
    const layers = testedLayers(project.layers, excluded[project.path] ?? []);
    return layers ? [[project.path, layers] as const] : [];
  });

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function useTestProjects() {
  const queryClient = useQueryClient();
  const setTestingProjects = usePatcherSessionStore((s) => s.setTestingProjects);

  return useMutation<null, AppError, TestProjectsArgs>({
    mutationFn: async ({ projects, includeProfile = false }) => {
      await writeBeforeTest();
      const result = await startPatcherSpendingQueue({
        workshopProjects: projects.map((p) => p.path),
        includeProfile,
        workshopLayers: workshopLayers(projects),
      });
      return unwrapForQuery(result);
    },
    onMutate: ({ projects }) => {
      setTestingProjects(projects.map(({ path, displayName }) => ({ path, displayName })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patcherKeys.status() });
    },
    onError: () => {
      setTestingProjects([]);
    },
  });
}
