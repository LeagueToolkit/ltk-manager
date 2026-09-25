import type { AssetRef, ContentTree, GameSearchHit } from "@/lib/tauri";

import type { SourceEntry } from "../../../gameBrowser/utils/sourceIndex";
import { compileQuery, matchQuery, startsQuery } from "../../../palette/utils/matcher";
import { entryChunkPath } from "../../links/hooks/useLinkTargets";
import { chunkPath } from "../../links/utils/linkDecision";
import { extensionOf } from "./pathField";

/** The maximum number of rows in the project group. A layer can have thousands of files. */
export const PROJECT_LIMIT = 50;

/** A file in one of the project's layers, with the chunk path a field uses for it. */
export interface ProjectFile {
  /** The chunk path, spelled as the author spelled it. */
  readonly path: string;
  readonly layer: string;
  /** Relative to the layer root, archive directory first. The layer asset uses this path. */
  readonly relativePath: string;
}

/** The source of a suggested file. */
export type PathSource =
  | { readonly kind: "layer"; readonly layer: string; readonly relativePath: string }
  | { readonly kind: "game"; readonly wad: string; readonly pathHash: string };

/** One file a path field can be set to. */
export interface PathSuggestion {
  /** The chunk path the field writes. */
  readonly path: string;
  readonly source: PathSource;
  /** The field's current value is this path. */
  readonly current: boolean;
}

/** The suggestion groups: project files, files in the current path's folder, and game files. */
export type PathGroupId = "project" | "folder" | "game";

/** One labelled group of suggestions, in the shape the grouped combobox expects. */
export interface PathGroup {
  readonly value: PathGroupId;
  readonly items: readonly PathSuggestion[];
}

/** Every project file a field can reference, which is every file inside an archive directory. */
export function projectFiles(tree: ContentTree): ProjectFile[] {
  return tree.layers.flatMap((layer) =>
    layer.entries.flatMap((entry) => {
      /* An ignored file is not packed, so the game cannot load it. */
      if (entry.ignoredBy !== null) return [];

      const path = entryChunkPath(entry.relativePath);
      if (path === null) return [];

      return [{ path, layer: layer.name, relativePath: entry.relativePath }];
    }),
  );
}

/**
 * The suggestions shown before anything is typed, per "A path field" in docs/ux/BIN_EDITOR.md.
 *
 * Project files of the expected kind, then the files in the current path's folder from the
 * project and the game. Each path appears once, in the first group that contains it.
 */
export function openingGroups(
  files: readonly ProjectFile[],
  value: string,
  extensions: readonly string[],
  gameFolder: readonly SourceEntry[],
): PathGroup[] {
  const current = value.toLowerCase();

  const project = files
    .filter((file) => fits(file.path, extensions))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, PROJECT_LIMIT)
    .map((file) => layerSuggestion(file, current));

  const shown = new Set(project.map((suggestion) => suggestion.path.toLowerCase()));
  const folder = folderOf(chunkPath(value));
  const beside: PathSuggestion[] = [];

  if (folder !== null) {
    for (const file of files) {
      if (folderOf(file.path.toLowerCase()) === folder) {
        beside.push(layerSuggestion(file, current));
      }
    }
    for (const entry of gameFolder) {
      if (entry.path !== null) beside.push(gameSuggestion(entry.path, entry, current));
    }
  }

  return grouped([
    ["project", project],
    ["folder", unseen(beside, shown)],
  ]);
}

/**
 * The suggestions for a typed query: matching project files, then matching game files.
 *
 * `hits` are already ranked by the backend. A game path that the project also has is listed
 * only as a project file, because the project's copy replaces the game's when the mod is on.
 */
export function searchGroups(
  files: readonly ProjectFile[],
  text: string,
  value: string,
  extensions: readonly string[],
  hits: readonly GameSearchHit[],
): PathGroup[] {
  const current = value.toLowerCase();
  const project = matchProjectFiles(files, text, extensions).map((file) =>
    layerSuggestion(file, current),
  );

  const inProject = new Set(files.map((file) => file.path.toLowerCase()));
  const game = hits.flatMap((hit) => {
    /* An unnamed chunk has no path to write, only its hash. */
    if (hit.path === "") return [];

    const path = `${hit.path}/${hit.name}`;
    return [gameSuggestion(path, hit, current)];
  });

  return grouped([
    ["project", project],
    ["game", unseen(game, inProject)],
  ]);
}

/**
 * The project files that `text` matches, ranked the same way as game index results.
 *
 * Expected kind first. Then a name that starts with the first term, a name that contains
 * every term, and a match that includes the folder. Ties go to the higher score, then the
 * shorter path.
 */
export function matchProjectFiles(
  files: readonly ProjectFile[],
  text: string,
  extensions: readonly string[],
): ProjectFile[] {
  const query = compileQuery(text);
  if (query === null) return [];

  const ranked: { file: ProjectFile; tier: number; band: number; score: number }[] = [];
  for (const file of files) {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const named = matchQuery(query, name);
    const match = named ?? matchQuery(query, file.path);
    if (match === null) continue;

    let band = 2;
    if (named !== null) band = startsQuery(query, name) ? 0 : 1;

    ranked.push({ file, tier: fits(file.path, extensions) ? 0 : 1, band, score: match.score });
  }

  return ranked
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.band - b.band ||
        b.score - a.score ||
        a.file.path.length - b.file.path.length ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, PROJECT_LIMIT)
    .map((entry) => entry.file);
}

/**
 * The file name of the document's archive, which the game search ranks first.
 *
 * A layer file's path starts with its archive directory, and a game chunk names its archive.
 */
export function archiveOf(asset: AssetRef | null): string | null {
  if (asset?.kind === "layer") {
    const cut = asset.path.indexOf("/");
    return cut < 0 ? null : asset.path.slice(0, cut);
  }
  if (asset?.kind === "gameChunk") return asset.wad.slice(asset.wad.lastIndexOf("/") + 1);

  return null;
}

/** The folder of a lowercased path, or null for no path. */
export function folderOf(path: string | null): string | null {
  if (path === null) return null;
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

function fits(path: string, extensions: readonly string[]): boolean {
  return extensions.length === 0 || extensions.includes(extensionOf(path));
}

function layerSuggestion(file: ProjectFile, current: string): PathSuggestion {
  return {
    path: file.path,
    source: { kind: "layer", layer: file.layer, relativePath: file.relativePath },
    current: file.path.toLowerCase() === current,
  };
}

function gameSuggestion(
  path: string,
  chunk: { wad: string; pathHash: string },
  current: string,
): PathSuggestion {
  return {
    path,
    source: { kind: "game", wad: chunk.wad, pathHash: chunk.pathHash },
    current: path === current,
  };
}

/** `suggestions` without the paths in `seen` and without repeats, compared in lowercase. */
function unseen(
  suggestions: readonly PathSuggestion[],
  seen: ReadonlySet<string>,
): PathSuggestion[] {
  const kept = new Set(seen);
  return suggestions.filter((suggestion) => {
    const key = suggestion.path.toLowerCase();
    if (kept.has(key)) return false;

    kept.add(key);
    return true;
  });
}

function grouped(groups: readonly (readonly [PathGroupId, PathSuggestion[]])[]): PathGroup[] {
  return groups.filter(([, items]) => items.length > 0).map(([value, items]) => ({ value, items }));
}
