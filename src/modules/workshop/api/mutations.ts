import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  api,
  type AppError,
  type CreateProjectArgs,
  type FantomePeekResult,
  type IgnoreRules,
  type ImportFantomeArgs,
  type ImportGitRepoArgs,
  type PackProjectArgs,
  type PackResult,
  type SaveProjectConfigArgs,
  type WorkshopProject,
} from "@/lib/tauri";
import { mutationFn, unwrapForQuery } from "@/utils/query";

import { useWorkshopEditorStore } from "../state";
import { workshopKeys } from "./keys";

export interface RenameProjectVariables {
  projectPath: string;
  newName: string;
}

export interface SetThumbnailVariables {
  projectPath: string;
  imagePath: string;
}

export interface RemoveThumbnailVariables {
  projectPath: string;
}

export interface SaveStringOverridesVariables {
  projectPath: string;
  layerName: string;
  stringOverrides: Record<string, Record<string, string>>;
}

export interface SaveIgnoreRulesVariables {
  projectPath: string;
  text: string;
}

/**
 * Put the rules a write answered with over the cached ones.
 *
 * The tree reads the same file, so a write that changed what ships invalidates
 * it rather than patching it: what a rule excludes is the backend's to decide.
 */
function putIgnoreRules(client: QueryClient, projectPath: string, saved: IgnoreRules): void {
  client.setQueryData(workshopKeys.ignoreRules(projectPath), saved);
  client.invalidateQueries({ queryKey: workshopKeys.contentTree(projectPath) });
}

/** Put a freshly made project at the front of the list. */
function addProject(client: QueryClient, created: WorkshopProject): void {
  client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
    old ? [created, ...old] : [created],
  );
}

/** Write one project back into both the list and its own entry. */
function replaceProject(client: QueryClient, updated: WorkshopProject): void {
  client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
    old?.map((project) => (project.path === updated.path ? updated : project)),
  );
  client.setQueryData(workshopKeys.project(updated.path), updated);
}

/** Writes against the workshop projects. */
export const projectMutations = {
  create: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, CreateProjectArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.createWorkshopProject(args)),
      onSuccess: (created) => addProject(client, created),
    }),

  remove: (client: QueryClient) =>
    mutationOptions<void, AppError, string>({
      mutationFn: async (projectPath) =>
        unwrapForQuery(await api.deleteWorkshopProject(projectPath)),
      onSuccess: (_answer, projectPath) => {
        client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
          old?.filter((project) => project.path !== projectPath),
        );
        client.removeQueries({ queryKey: workshopKeys.project(projectPath) });

        /* The editor persists its strip under the project path, and a deleted
           project never comes back to claim it. */
        useWorkshopEditorStore.getState().forgetProject(projectPath);
      },
    }),

  /* The path is what changed, so every project query goes rather than one entry. */
  rename: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, RenameProjectVariables>({
      mutationFn: async ({ projectPath, newName }) =>
        unwrapForQuery(await api.renameWorkshopProject(projectPath, newName)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: workshopKeys.projects() });
      },
    }),

  saveConfig: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, SaveProjectConfigArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.saveProjectConfig(args)),
      onSuccess: (updated) => replaceProject(client, updated),
    }),

  setThumbnail: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, SetThumbnailVariables>({
      /* ThumbnailSection and NewProjectDialog report. */
      meta: { silentError: true },
      mutationFn: mutationFn(({ projectPath, imagePath }: SetThumbnailVariables) =>
        api.setProjectThumbnail(projectPath, imagePath),
      ),
      onSuccess: (updated) => {
        replaceProject(client, updated);

        /* The backend path never changes - always thumbnail.webp - so
           `convertFileSrc` answers the URL the webview already has cached. The
           timestamp is what makes it fetch the new file. */
        if (updated.thumbnailPath) {
          client.setQueryData(
            workshopKeys.thumbnail(updated.path, updated.thumbnailPath),
            `${convertFileSrc(updated.thumbnailPath)}?v=${Date.now()}`,
          );
        }
      },
    }),

  removeThumbnail: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, RemoveThumbnailVariables>({
      /* ThumbnailSection reports. */
      meta: { silentError: true },
      mutationFn: mutationFn(({ projectPath }: RemoveThumbnailVariables) =>
        api.removeProjectThumbnail(projectPath),
      ),
      onSuccess: (updated) => {
        replaceProject(client, updated);
        client.removeQueries({
          queryKey: workshopKeys.thumbnail(updated.path, ""),
          exact: false,
        });
      },
    }),

  saveStringOverrides: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, SaveStringOverridesVariables>({
      mutationFn: async ({ projectPath, layerName, stringOverrides }) =>
        unwrapForQuery(await api.saveLayerStringOverrides(projectPath, layerName, stringOverrides)),
      onSuccess: (updated) => replaceProject(client, updated),
    }),

  pack: () =>
    mutationOptions<PackResult, AppError, PackProjectArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.packWorkshopProject(args)),
    }),
} as const;

/** Writes against a project's `.modignore`. */
export const ignoreRuleMutations = {
  /* The document reports a blocked save on the line it names, so a toast over
     the top of it would say the same thing twice. */
  save: (client: QueryClient) =>
    mutationOptions<IgnoreRules, AppError, SaveIgnoreRulesVariables>({
      meta: { silentError: true },
      mutationFn: async ({ projectPath, text }) =>
        unwrapForQuery(await api.ignoreRules.save(projectPath, text)),
      onSuccess: (saved, { projectPath }) => putIgnoreRules(client, projectPath, saved),
    }),

  addRecommended: (client: QueryClient) =>
    mutationOptions<IgnoreRules, AppError, string>({
      mutationFn: async (projectPath) =>
        unwrapForQuery(await api.ignoreRules.addRecommended(projectPath)),
      onSuccess: (saved, projectPath) => putIgnoreRules(client, projectPath, saved),
    }),
} as const;

/** Ways a project arrives from outside the workshop. */
export const projectImportMutations = {
  fromFantome: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, ImportFantomeArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.importFromFantome(args)),
      onSuccess: (created) => addProject(client, created),
    }),

  fromGitRepo: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, ImportGitRepoArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.importFromGitRepo(args)),
      onSuccess: (created) => addProject(client, created),
    }),

  fromModpkg: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, string>({
      mutationFn: async (filePath) => unwrapForQuery(await api.importFromModpkg(filePath)),
      onSuccess: (created) => addProject(client, created),
    }),

  /** What a `.fantome` holds, read without unpacking it. */
  peekFantome: () =>
    mutationOptions<FantomePeekResult, AppError, string>({
      mutationFn: async (filePath) => unwrapForQuery(await api.peekFantome(filePath)),
    }),
} as const;
