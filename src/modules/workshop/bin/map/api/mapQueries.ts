import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import { modelPreviewUrl } from "@/lib/previewUrl";
import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type MapCharacter,
  type MapChunk,
  type MapFiles,
  type MapGeometryMesh,
  type MapParticle,
  type MapPath,
  type MapVariant,
  type SandboxRef,
  type UpAxis,
} from "@/lib/tauri";
import { MAP_FILES_NEAR_ROOT, MAP_FILES_ROOT } from "@/modules/viewport";
import { queryFnWithArgs, unwrapForQuery } from "@/utils/query";

import { type ModelPreview, readModelPreview } from "../utils/meshImport";

/** The reads a map's scene draws from, each keyed on the open document it asks. */
export const mapQueries = {
  /** The maps the `Map`, `MapSkin` or `MapContainer` at `entry` draws. */
  variants: (document: BinDocumentId | null, entry: string | null) =>
    queryOptions<MapVariant[], AppError>({
      queryKey: ["map-variants", document, entry],
      queryFn:
        document === null || entry === null
          ? skipToken
          : queryFnWithArgs(api.bin.readMapVariants, document, entry),
      staleTime: Infinity,
      retry: false,
    }),
  /** Every particle the open `.materials.bin` under `document` stands in its map. */
  particles: (document: BinDocumentId | null) =>
    queryOptions<MapParticle[], AppError>({
      queryKey: ["map-particles", document],
      queryFn: document === null ? skipToken : queryFnWithArgs(api.bin.readMapParticles, document),
      staleTime: Infinity,
      retry: false,
    }),
  /** Every character the open `.materials.bin` under `document` stands in its map. */
  characters: (document: BinDocumentId | null) =>
    queryOptions<MapCharacter[], AppError>({
      queryKey: ["map-characters", document],
      queryFn: document === null ? skipToken : queryFnWithArgs(api.bin.readMapCharacters, document),
      staleTime: Infinity,
      retry: false,
    }),
  /** Every chunk the open `.materials.bin` under `document` declares, and what each holds. */
  outline: (document: BinDocumentId | null) =>
    queryOptions<MapChunk[], AppError>({
      queryKey: ["map-outline", document],
      queryFn: document === null ? skipToken : queryFnWithArgs(api.bin.readMapOutline, document),
      staleTime: Infinity,
      retry: false,
    }),
  /** The entry path of every `StaticMaterialDef` of the open `.materials.bin`, sorted. */
  materialDefs: (document: BinDocumentId | null) =>
    queryOptions<string[], AppError>({
      queryKey: ["map-material-defs", document],
      queryFn:
        document === null
          ? skipToken
          : async () =>
              unwrapForQuery(await api.bin.roots(document))
                .flatMap((row) =>
                  row.value.type === "struct" && row.value.class === "StaticMaterialDef"
                    ? [row.name]
                    : [],
                )
                .sort(),
      staleTime: Infinity,
      retry: false,
    }),
  /** Every mesh of the `.mapgeo` open for edits under `id`, at its `revision`. */
  geometryMeshes: (id: number | null, revision: number) =>
    queryOptions<MapGeometryMesh[], AppError>({
      queryKey: ["map-geometry-meshes", id, revision],
      queryFn: id === null ? skipToken : queryFnWithArgs(api.bin.mapGeometryMeshes, id),
      staleTime: Infinity,
      retry: false,
      placeholderData: keepPreviousData,
    }),
  /** Where the two files of `map` live in `sandbox`, its layers checked first. */
  files: (sandbox: SandboxRef, map: MapPath | null) =>
    queryOptions<MapFiles, AppError>({
      queryKey: [...MAP_FILES_ROOT, sandbox, map],
      queryFn: map === null ? skipToken : queryFnWithArgs(api.bin.locateMapFiles, sandbox, map),
      /* The same map in another sandbox, so a change of chosen layers keeps the scene open. */
      placeholderData: (previous, query) => (query?.queryKey.at(-1) === map ? previous : undefined),
      staleTime: Infinity,
      retry: false,
    }),
  /**
   * Where each of `paths` lives in `sandbox`, its layers checked first, asked in one call.
   * A path nothing holds is absent.
   */
  filesNear: (sandbox: SandboxRef, paths: readonly string[]) =>
    queryOptions<Partial<Record<string, AssetRef>>, AppError>({
      queryKey: [...MAP_FILES_NEAR_ROOT, sandbox, paths],
      queryFn: async () =>
        paths.length === 0 ? {} : unwrapForQuery(await api.bin.locateFilesNear(sandbox, paths)),
      placeholderData: (previous, query) =>
        JSON.stringify(query?.queryKey.at(-1)) === JSON.stringify(paths) ? previous : undefined,
      staleTime: Infinity,
      retry: false,
    }),
  /** The import preview of `meshes` of the model file at `path`. */
  importPreview: (path: string, meshes: readonly number[], scale: number, up: UpAxis) =>
    queryOptions<ModelPreview, Error>({
      queryKey: ["map-import-preview", path, meshes, scale, up],
      queryFn: async () => {
        const answer = await fetch(modelPreviewUrl(path, meshes, scale, up));
        if (!answer.ok) throw new Error(await answer.text());
        return readModelPreview(await answer.arrayBuffer());
      },
      staleTime: Infinity,
      retry: false,
      placeholderData: keepPreviousData,
    }),
};
