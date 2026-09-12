import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  api,
  type AppError,
  type ContentTree,
  type IgnoreRules,
  type ProjectText,
  type ProjectTextFile,
  type Run,
  type StringKeySearchResult,
  type ValidationResult,
  type WorkshopLayerInfo,
  type WorkshopProject,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs, unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

/**
 * How long a content scan stays fresh, in milliseconds.
 *
 * The backend answers that query by walking every layer of the project and
 * returning every file, with no truncation. At `staleTime: 0` each focus of the
 * window paid for that walk again, so alternating with an external editor
 * re-scanned the whole project on every trip back.
 *
 * A window is the wrong instrument for this and a watch on the content
 * directory is the right one. Until then this bounds the cost to one walk per
 * interval while a save in another application still lands within it.
 */
const CONTENT_SCAN_STALE_MS = 10_000;

/** A workshop project, and everything a page reads off one. */
export const projectQueries = {
  all: () =>
    queryOptions<WorkshopProject[], AppError>({
      queryKey: workshopKeys.projects(),
      queryFn: queryFn(api.getWorkshopProjects),
    }),

  byPath: (projectPath: string | undefined) =>
    queryOptions<WorkshopProject, AppError>({
      queryKey: workshopKeys.project(projectPath ?? ""),
      queryFn: projectPath ? queryFnWithArgs(api.getWorkshopProject, projectPath) : skipToken,
    }),

  /* Refetches on window focus so external edits to the content directory surface
     without a manual refresh, throttled by `CONTENT_SCAN_STALE_MS`. Every
     mutation that writes into a layer invalidates the key directly, so a change
     made in the app never waits for that interval. */
  contentTree: (projectPath: string | undefined) =>
    queryOptions<ContentTree, AppError>({
      queryKey: workshopKeys.contentTree(projectPath ?? ""),
      queryFn: projectPath ? queryFnWithArgs(api.getProjectContentTree, projectPath) : skipToken,
      refetchOnWindowFocus: true,
      staleTime: CONTENT_SCAN_STALE_MS,
    }),

  /* A run is a fact about the files as they were at one moment, so nothing
     refreshes it on its own. The panel's re-run button is how a user asks for a
     newer one, and a fix or an undo invalidates this key. */
  problems: (projectPath: string | undefined) =>
    queryOptions<Run, AppError>({
      queryKey: workshopKeys.problems(projectPath ?? ""),
      queryFn: projectPath ? queryFnWithArgs(api.analyzeProject, projectPath) : skipToken,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }),

  /* The answer is the final asset URL rather than a raw path, so `setQueryData`
     can inject a cache-busted URL directly. */
  thumbnail: (projectPath: string, thumbnailPath: string | null | undefined) =>
    queryOptions<string, AppError>({
      queryKey: workshopKeys.thumbnail(projectPath, thumbnailPath),
      queryFn: thumbnailPath
        ? async () => {
            const path = unwrapForQuery(await api.getProjectThumbnail(thumbnailPath));
            return path ? convertFileSrc(path) : "";
          }
        : skipToken,
      staleTime: Infinity,
    }),

  /* Refetched on focus the way the content tree is, because the file is as
     editable from outside the app as the layer beside it. */
  ignoreRules: (projectPath: string | undefined, at: string | null = null) =>
    queryOptions<IgnoreRules, AppError>({
      queryKey: workshopKeys.ignoreRules(projectPath ?? "", at),
      queryFn: projectPath
        ? async () => unwrapForQuery(await api.ignoreRules.read(projectPath, at))
        : skipToken,
      refetchOnWindowFocus: true,
      staleTime: CONTENT_SCAN_STALE_MS,
    }),

  /* Refetched on focus for the reason the rules are: a creator writes prose in
     a real editor as readily as in this one. */
  projectText: (projectPath: string | undefined, file: ProjectTextFile) =>
    queryOptions<ProjectText, AppError>({
      queryKey: workshopKeys.projectText(projectPath ?? "", file),
      queryFn: projectPath
        ? async () => unwrapForQuery(await api.projectText.read(projectPath, file))
        : skipToken,
      refetchOnWindowFocus: true,
      staleTime: CONTENT_SCAN_STALE_MS,
    }),

  /* A constant the backend owns, so one fetch a session is the whole cost. */
  recommendedIgnoreRules: () =>
    queryOptions<string, AppError>({
      queryKey: workshopKeys.recommendedIgnoreRules(),
      queryFn: async () => unwrapForQuery(await api.ignoreRules.recommended()),
      staleTime: Infinity,
    }),

  validation: (projectPath: string | undefined) =>
    queryOptions<ValidationResult, AppError>({
      queryKey: workshopKeys.validation(projectPath ?? ""),
      queryFn: projectPath ? queryFnWithArgs(api.validateProject, projectPath) : skipToken,
    }),

  layerInfo: (projectPath: string, layerNames: string[]) =>
    queryOptions<Record<string, WorkshopLayerInfo>, AppError>({
      queryKey: workshopKeys.layerInfoFor(projectPath, layerNames),
      queryFn: queryFnWithArgs(api.getLayerInfo, projectPath, layerNames),
    }),
} as const;

/** The stringtable index, as the override editor reads it. */
export const stringQueries = {
  /* The first request builds the backend index, downloading the key list when
     needed, so it can take a few seconds. */
  keySearch: (query: string) =>
    queryOptions<StringKeySearchResult, AppError>({
      queryKey: workshopKeys.stringKeySearch(query),
      queryFn: async () => unwrapForQuery(await api.searchStringKeys(query, 50)),
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      retry: false,
    }),

  /* A key the game does not resolve is absent, and the editor shows no original
     line for it. The backend shares the suggestion index, so the first call of a
     session can take a few seconds while that index builds. */
  values: (keys: readonly string[]) =>
    queryOptions<Record<string, string>, AppError>({
      queryKey: workshopKeys.stringValues(keys),
      queryFn: async () => unwrapForQuery(await api.lookupStringValues([...keys])),
      enabled: keys.length > 0,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      retry: false,
    }),
} as const;
