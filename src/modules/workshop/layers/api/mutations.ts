import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type WorkshopProject } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "../../api/keys";

export interface CreateLayerVariables {
  projectPath: string;
  name: string;
  displayName?: string;
  description?: string;
}

export interface DeleteLayerVariables {
  projectPath: string;
  layerName: string;
}

export interface RenameLayerVariables {
  projectPath: string;
  layerName: string;
  newDisplayName: string;
}

export interface ReorderLayersVariables {
  projectPath: string;
  layerNames: string[];
}

export interface UpdateLayerDescriptionVariables {
  projectPath: string;
  layerName: string;
  description?: string;
}

/** The projects list as it stood before an optimistic reorder. */
interface ProjectsRollback {
  previous?: WorkshopProject[];
}

/** Write one project back into both the list and its own entry. */
function replaceProject(client: QueryClient, updated: WorkshopProject): void {
  client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
    old?.map((project) => (project.path === updated.path ? updated : project)),
  );
  client.setQueryData(workshopKeys.project(updated.path), updated);
}

/** Write the project back and drop what the layer set changed under it. */
function replaceProjectAndLayers(client: QueryClient, updated: WorkshopProject): void {
  replaceProject(client, updated);
  client.invalidateQueries({ queryKey: workshopKeys.layerInfo(updated.path) });
}

/** `project` with `layerNames` renumbered, base held at priority 0. */
function withLayerOrder(project: WorkshopProject, layerNames: string[]): WorkshopProject {
  const byName = new Map(project.layers.map((layer) => [layer.name, layer]));
  const base = byName.get("base");
  const layers: WorkshopProject["layers"] = base ? [{ ...base, priority: 0 }] : [];

  layerNames.forEach((name, index) => {
    const layer = byName.get(name);
    if (layer) layers.push({ ...layer, priority: index + 1 });
  });

  return { ...project, layers };
}

/** Writes against a project's layers. */
export const layerMutations = {
  create: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, CreateLayerVariables>({
      mutationFn: async ({ projectPath, name, displayName, description }) =>
        unwrapForQuery(await api.createProjectLayer(projectPath, name, displayName, description)),
      onSuccess: (updated) => replaceProjectAndLayers(client, updated),
    }),

  remove: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, DeleteLayerVariables>({
      mutationFn: async ({ projectPath, layerName }) =>
        unwrapForQuery(await api.deleteProjectLayer(projectPath, layerName)),
      onSuccess: (updated) => replaceProjectAndLayers(client, updated),
    }),

  rename: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, RenameLayerVariables>({
      mutationFn: async ({ projectPath, layerName, newDisplayName }) =>
        unwrapForQuery(await api.renameProjectLayer(projectPath, layerName, newDisplayName)),
      onSuccess: (updated) => replaceProjectAndLayers(client, updated),
    }),

  describe: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, UpdateLayerDescriptionVariables>({
      mutationFn: async ({ projectPath, layerName, description }) =>
        unwrapForQuery(await api.updateLayerDescription(projectPath, layerName, description)),
      onSuccess: (updated) => replaceProject(client, updated),
    }),

  /* Optimistic on the projects list, which is what `ProjectProvider` reads. */
  reorder: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, ReorderLayersVariables, ProjectsRollback>({
      mutationFn: async ({ projectPath, layerNames }) =>
        unwrapForQuery(await api.reorderProjectLayers(projectPath, layerNames)),
      onMutate: async ({ projectPath, layerNames }) => {
        await client.cancelQueries({ queryKey: workshopKeys.projects() });
        const previous = client.getQueryData<WorkshopProject[]>(workshopKeys.projects());
        client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
          old?.map((project) =>
            project.path === projectPath ? withLayerOrder(project, layerNames) : project,
          ),
        );
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          client.setQueryData(workshopKeys.projects(), context.previous);
        }
      },
      onSettled: () => {
        client.invalidateQueries({ queryKey: workshopKeys.projects() });
      },
    }),
} as const;
