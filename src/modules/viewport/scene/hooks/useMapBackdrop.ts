import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ClampToEdgeWrapping, NoColorSpace, type Texture } from "three";

import {
  api,
  type AssetRef,
  type BinDocumentId,
  type MapModel,
  type MapPath,
  type MaterialPreview,
  type MaterialProgram,
} from "@/lib/tauri";

import { BACKDROP_ROOT } from "../../assets/api/placements";
import { viewportQueries } from "../../assets/api/queries";
import type { LightGrid } from "../../assets/parsing/lightGridBuffer";
import {
  type MapGeometry,
  type MapLayer,
  mapLayers,
  mapOrigin,
  openingFlags,
} from "../../assets/parsing/mapBuffer";
import { programTextureAssets } from "../../hexshade/programTextures";
import { useAssetTextures } from "../../shared/hooks/useAssetTextures";
import { type AmbientOcclusion, ambientOcclusionOf } from "../utils/ambientOcclusion";
import { type PostEffects, postEffectsOf } from "../utils/postEffects";
import { type SunLight, sunLightOf } from "../utils/sunLight";

/** Where the install keeps every map's geometry, one directory per map. */
const MAP_GEOMETRY_DIR = "data/maps/mapgeometry";

/** The prefix under which a map's files sit, which mirrors `MapPath` in core. */
const DATA_PREFIX = "data/";

/** The suffix a map's geometry carries, which mirrors `MapPath::geometry` in core. */
const GEOMETRY_SUFFIX = ".mapgeo";

/** The one sky the install ships, which every map's archive carries a copy of. */
const SKY_PATH = "assets/maps/skyboxes/riots_sru_skybox_cubemap.dds";

/** The suffix a map's materials carry, which mirrors `MapPath::materials` in core. */
const MATERIALS_SUFFIX = ".materials.bin";

/**
 * The width a map's textures land at before the whole ones replace them.
 *
 * 183 textures at full size is seconds of grey, and a mip this wide is a few kilobytes
 * each, so the map draws at once and sharpens after.
 */
const PREVIEW_WIDTH = 64;

/**
 * The widest a backdrop's textures are asked for.
 *
 * A map ships kit textures at 2048, which a surface drawn behind the subject never
 * resolves, and 183 of those are the seconds of stutter the mip pass was meant to end.
 */
const FULL_WIDTH = 1024;

/**
 * How many of a map's textures are in flight at once.
 *
 * Each costs a decode in the backend and an upload on the render thread, so a whole
 * set asked for at once lands in bursts no frame absorbs.
 */
const CONCURRENT = 4;

/** Which map a backdrop draws, and the project whose layer answers before the install. */
export interface BackdropSource {
  readonly map: MapPath;
  /** Any open document of that project, and null outside one. */
  readonly document: BinDocumentId | null;
  /**
   * The project directory `document` answers from, and null for one answering from the
   * install alone.
   *
   * Present, every source naming the same project shares the reads, so another skin of
   * it opens on a map already read. Absent, the reads are `document`'s own.
   */
  readonly project?: string | null;
  /**
   * The map's `.mapgeo` where the scene has already found it, such as a copy a project
   * ships. Absent, the install's is looked up.
   */
  readonly geometry?: AssetRef;
  /** The map's materials draw with the game's own shaders, translated. */
  readonly shaders?: boolean;
}

/** Who answers a map's reads through a document, which is what two sources share them by. */
type ReadScope = { readonly project: string | null } | { readonly document: BinDocumentId | null };

function readScope(source: BackdropSource | null): ReadScope {
  if (source?.project !== undefined) return { project: source.project };
  return { document: source?.document ?? null };
}

/** One map the install can draw a backdrop from. */
export interface BackdropChoice {
  readonly map: MapPath;
  /** The directory the geometry sits in, `map11`, which is what names the map. */
  readonly folder: string;
  /** The geometry's own file name without its suffix, `base_srx`. */
  readonly geometry: string;
}

/**
 * One of a map's files, which mirrors `MapPath::file` in core.
 *
 * An entry path names no file of its own: each of a map's files is that path lowercased
 * under the data prefix with the file's own suffix.
 */
function mapFile(map: MapPath, suffix: string): string {
  return `${DATA_PREFIX}${map.toLowerCase()}${suffix}`;
}

/**
 * Where the install keeps a map's files.
 *
 * Every one of these is `staleTime: Infinity`, so a read that failed must reject rather
 * than answer nothing: an empty answer is cached as the truth about the install, and one
 * momentary failure would draw the map flat or missing for the rest of the session.
 */
export const backdropQueries = {
  /* The index answers a directory as a lookup rather than a walk, so enumerating every
     map is one read of the geometry root and one of each map under it. */
  maps: () =>
    queryOptions<readonly BackdropChoice[]>({
      queryKey: [...BACKDROP_ROOT, "maps"],
      queryFn: async () => {
        const root = await api.readGameDir(MAP_GEOMETRY_DIR);
        if (!root.ok) throw root.error;
        const listings = await Promise.all(
          root.value.dirs.map(async (dir) => ({ dir, read: await api.readGameDir(dir.path) })),
        );
        const found: BackdropChoice[] = [];
        for (const { dir, read } of listings) {
          if (!read.ok) throw read.error;
          for (const file of read.value.files) {
            const path = file.path;
            if (path === null) continue;
            if (!path.startsWith(DATA_PREFIX) || !path.endsWith(GEOMETRY_SUFFIX)) continue;
            const map = path.slice(DATA_PREFIX.length, -GEOMETRY_SUFFIX.length);
            found.push({
              map,
              folder: dir.name,
              geometry: map.slice(map.lastIndexOf("/") + 1),
            });
          }
        }
        found.sort((a, b) => a.map.localeCompare(b.map, undefined, { numeric: true }));
        return found;
      },
      staleTime: Infinity,
      retry: false,
    }),

  sky: () =>
    queryOptions<AssetRef | null>({
      queryKey: [...BACKDROP_ROOT, "sky"],
      queryFn: async () => {
        const answer = await api.objects.locateGameFiles([SKY_PATH]);
        if (!answer.ok) throw answer.error;
        const found = answer.value[SKY_PATH];
        return found === undefined
          ? null
          : { kind: "gameChunk", wad: found.wad, pathHash: found.pathHash };
      },
      staleTime: Infinity,
      retry: false,
    }),

  chunk: (map: MapPath | null, suffix: string) =>
    queryOptions<AssetRef | null>({
      queryKey: [...BACKDROP_ROOT, map, suffix],
      queryFn: async () => {
        if (map === null) return null;
        const path = mapFile(map, suffix);
        const answer = await api.objects.locateGameFiles([path]);
        if (!answer.ok) throw answer.error;
        const held = answer.value[path];
        if (held === undefined) return null;
        return { kind: "gameChunk", wad: held.wad, pathHash: held.pathHash };
      },
      staleTime: Infinity,
      retry: false,
    }),

  /* Each input is named rather than reached through a source object, so the key holds
     what the answer depends on. The scope stands in for the document, because every
     document of one project answers alike. The paths are the buffer's own string table,
     so their identity is stable for as long as the answer is. */
  model: (
    map: MapPath | null,
    document: BinDocumentId | null,
    scope: ReadScope,
    paths: readonly string[] | null,
  ) =>
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the scope keys the document
    queryOptions<MapModel>({
      queryKey: [...BACKDROP_ROOT, "model", map, scope, paths],
      queryFn: async () => {
        if (map === null || paths === null)
          return { materials: [], sun: null, postEffects: null, ssao: null, lightGrid: null };
        const answer = await api.bin.readMap(document, map, [...paths]);
        if (!answer.ok) throw answer.error;
        return answer.value;
      },
      enabled: map !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),

  /* The materials bin is read for the call rather than opened as a document, since a
     backdrop stands outside any project's documents. */
  programs: (
    materials: AssetRef | null,
    document: BinDocumentId | null,
    scope: ReadScope,
    paths: readonly string[] | null,
  ) =>
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the scope keys the document
    queryOptions<(MaterialProgram | null)[]>({
      queryKey: [...BACKDROP_ROOT, "programs", materials, scope, paths],
      queryFn: async () => {
        if (materials === null || paths === null) return [];
        const answer = await api.bin.readMaterialPrograms(
          { kind: "file", asset: materials, document },
          paths,
          { lowQuality: false },
        );
        if (!answer.ok) throw answer.error;
        return answer.value;
      },
      enabled: materials !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),

  /* Located beside the geometry, so a project's copy of a light map wins over the
     install's as its geometry does. */
  lightmaps: (near: AssetRef | null, paths: readonly string[] | null) =>
    queryOptions<ReadonlyMap<string, AssetRef>>({
      queryKey: [...BACKDROP_ROOT, "lightmaps", near, paths],
      queryFn: async () => {
        if (near === null || paths === null || paths.length === 0) return new Map();
        const answer = await api.bin.locateFilesNear(near, paths);
        if (!answer.ok) throw answer.error;
        return new Map(Object.entries(answer.value));
      },
      enabled: near !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),
};

/** A map backdrop's geometry and materials, and what it is doing while there is none. */
export interface Backdrop {
  readonly geometry: MapGeometry | null;
  /** The visibility flags the map opens on, and 0 while there is no geometry. */
  readonly opening: number;
  /** Where a subject stands on this map before anyone moves it, in the map's own space. */
  readonly origin: readonly [number, number, number] | null;
  /** One per entry of `geometry.materials`, and null where the map declares none. */
  readonly materials: readonly (MaterialPreview | null)[];
  /** Each material's base texture, under the material's own entry path. */
  readonly textures: ReadonlyMap<string, Texture>;
  /** One per entry of `materials` while the shaders are on, and none otherwise. */
  readonly programs: readonly (MaterialProgram | null)[];
  /** The textures the programs sample, keyed as `programWith` reads them. */
  readonly programTextures: ReadonlyMap<string, Texture>;
  /** The light maps the meshes name, by path, once the shaders are on. */
  readonly lightmaps: ReadonlyMap<string, Texture>;
  /** The light the map states, and null until it lands or where it states none. */
  readonly sun: SunLight | null;
  /** The post effects the map states, and null until they land or where it states none. */
  readonly postEffects: PostEffects | null;
  /** The ambient occlusion the map states, and null until it lands or where it states none. */
  readonly ambientOcclusion: AmbientOcclusion | null;
  /** The ambient the map lights its characters with, and null where it bakes none. */
  readonly lightGrid: LightGrid | null;
  /** The bytes are on their way. One map is 73 to 93 MiB, so this is seconds. */
  readonly loading: boolean;
  /** Why there is nothing to draw, for the one line a disabled option carries. */
  readonly failure: string | null;
}

const NO_MATERIALS: readonly (MaterialPreview | null)[] = [];
const NO_PROGRAMS: readonly (MaterialProgram | null)[] = [];
const NO_LAYERS: readonly MapLayer[] = [];
const NO_TEXTURES: ReadonlyMap<string, Texture> = new Map();
const NO_ASSETS: ReadonlyMap<string, AssetRef> = new Map();

/** What has no program: a map with the shaders off. */
const EMPTY: Backdrop = {
  geometry: null,
  opening: 0,
  origin: null,
  materials: NO_MATERIALS,
  textures: NO_TEXTURES,
  programs: NO_PROGRAMS,
  programTextures: NO_TEXTURES,
  lightmaps: NO_TEXTURES,
  sun: null,
  postEffects: null,
  ambientOcclusion: null,
  lightGrid: null,
  loading: false,
  failure: null,
};

/** Every map this install can draw a backdrop from, in map order. */
export function useBackdropMaps() {
  return useQuery(backdropQueries.maps());
}

/**
 * Where the install keeps `map`'s `.materials.bin`, and null until it is found.
 *
 * The file a scene opens to read what the map stands in it, such as its particles.
 */
export function useBackdropMaterials(map: MapPath | null): AssetRef | null {
  return useQuery(backdropQueries.chunk(map, MATERIALS_SUFFIX)).data ?? null;
}

/**
 * The map `source` names, fetched once and decoded once.
 *
 * The geometry arrives whole in one buffer, so nothing streams as the camera moves
 * (ADR-0044). The materials, the sun and the screen effects follow it over IPC, because
 * they join the buffer's own string table and so cannot be asked for until it has landed.
 */
export function useMapBackdrop(source: BackdropSource | null): Backdrop {
  const { given, located, asset, geometry } = useBackdropGeometry(source);
  const model = useBackdropModel(source, geometry.data);
  const materials = model.data?.materials;
  const sun = useMemo(
    () => (model.data?.sun == null ? null : sunLightOf(model.data.sun)),
    [model.data],
  );
  const postEffects = useMemo(
    () => (model.data?.postEffects == null ? null : postEffectsOf(model.data.postEffects)),
    [model.data],
  );
  const ambientOcclusion = useMemo(
    () => (model.data?.ssao == null ? null : ambientOcclusionOf(model.data.ssao)),
    [model.data],
  );

  const lightGrid = useQuery(viewportQueries.lightGrid(model.data?.lightGrid ?? null)).data;

  const assets = useMemo(() => {
    const held = new Map<string, AssetRef>();
    const paths = geometry.data?.materials ?? [];
    for (const [at, slots] of (materials ?? []).entries()) {
      const asset = slots?.base?.texture.asset;
      const path = paths[at];
      if (asset != null && path !== undefined) held.set(path, asset);
    }
    return held;
  }, [geometry.data, materials]);
  const textures = useAssetTextures(assets, {
    previewWidth: PREVIEW_WIDTH,
    fullWidth: FULL_WIDTH,
    concurrency: CONCURRENT,
    mips: true,
  });
  const shaders = source?.shaders === true;
  const materialsFile = useQuery(
    backdropQueries.chunk(shaders ? (source?.map ?? null) : null, MATERIALS_SUFFIX),
  );
  const programsRead = useQuery(
    backdropQueries.programs(
      shaders ? (materialsFile.data ?? null) : null,
      source?.document ?? null,
      readScope(source),
      geometry.data?.materials ?? null,
    ),
  );
  const programs = programsRead.data ?? NO_PROGRAMS;
  const lightmapAssets = useQuery(
    backdropQueries.lightmaps(shaders ? asset : null, geometry.data?.lightmaps ?? null),
  ).data;
  const lightmaps = useAssetTextures(lightmapAssets ?? NO_ASSETS, {
    fullWidth: FULL_WIDTH,
    concurrency: CONCURRENT,
    mips: true,
    colorSpace: NoColorSpace,
    /* An atlas, whose edges must not bleed into one another. */
    wrap: ClampToEdgeWrapping,
  });
  const programAssets = useMemo(() => programTextureAssets(programs), [programs]);
  const programTextures = useAssetTextures(programAssets, {
    previewWidth: PREVIEW_WIDTH,
    fullWidth: FULL_WIDTH,
    concurrency: CONCURRENT,
    mips: true,
    colorSpace: NoColorSpace,
  });
  const opening = useMemo(
    () => (geometry.data === undefined ? 0 : openingFlags(geometry.data)),
    [geometry.data],
  );
  /* Two million vertices walked once per map, so it is held rather than asked per frame.
     Off the opening flags rather than the active ones, so a toggle moves no subject. */
  const origin = useMemo(
    () => (geometry.data === undefined ? null : mapOrigin(geometry.data, opening)),
    [geometry.data, opening],
  );

  if (source === null) return EMPTY;
  if ((given === undefined && located.isPending) || (asset !== null && geometry.isPending)) {
    return { ...EMPTY, loading: true };
  }
  if (asset === null) {
    return { ...EMPTY, failure: "This install has no geometry for that map" };
  }
  if (geometry.error !== null) {
    return { ...EMPTY, failure: geometry.error.message };
  }
  return {
    geometry: geometry.data ?? null,
    opening,
    origin,
    materials: materials ?? NO_MATERIALS,
    textures,
    programs,
    programTextures,
    lightmaps,
    sun,
    postEffects,
    ambientOcclusion,
    lightGrid: lightGrid ?? null,
    loading: false,
    failure: null,
  };
}

/** Where `source`'s geometry is and the geometry itself, read once however many ask. */
function useBackdropGeometry(source: BackdropSource | null) {
  const given = source?.geometry;
  const located = useQuery(
    backdropQueries.chunk(given === undefined ? (source?.map ?? null) : null, GEOMETRY_SUFFIX),
  );
  const asset = given ?? located.data ?? null;
  const geometry = useQuery(viewportQueries.map(asset));
  return { given, located, asset, geometry };
}

/** The materials, sun and screen effects of `source`'s map, asked for once `geometry` lands. */
function useBackdropModel(source: BackdropSource | null, geometry: MapGeometry | undefined) {
  return useQuery(
    backdropQueries.model(
      source?.map ?? null,
      source?.document ?? null,
      readScope(source),
      geometry?.materials ?? null,
    ),
  );
}

/**
 * The light `source`'s map states, and null until it lands or where it states none.
 *
 * The read is the one [`useMapBackdrop`] makes, so asking here fetches nothing.
 */
export function useBackdropSun(source: BackdropSource | null): SunLight | null {
  const sun = useBackdropModel(source, useBackdropGeometry(source).geometry.data).data?.sun;
  return useMemo(() => (sun == null ? null : sunLightOf(sun)), [sun]);
}

/**
 * The post effects `source`'s map states, and null until they land or where it states none.
 *
 * The read is the one [`useMapBackdrop`] makes, so asking here fetches nothing.
 */
export function useBackdropPostEffects(source: BackdropSource | null): PostEffects | null {
  const model = useBackdropModel(source, useBackdropGeometry(source).geometry.data);
  const effects = model.data?.postEffects;
  return useMemo(() => (effects == null ? null : postEffectsOf(effects)), [effects]);
}

/** The visibility flags a backdrop draws, and the layers its map offers to toggle. */
export interface BackdropFlags {
  /** Every layer a mesh of the map names, and none until the geometry lands. */
  readonly layers: readonly MapLayer[];
  /** The active set as a mask, and 0 until the geometry lands. */
  readonly flags: number;
  readonly setLayer: (index: number, on: boolean) => void;
}

/**
 * The visibility flags `source`'s backdrop draws, opening on the map's own and toggled after.
 *
 * A toggle is held against the geometry it was made on, so another map opens on its own
 * flags. The geometry is the one [`useMapBackdrop`] reads, so asking here fetches nothing.
 */
export function useBackdropFlags(source: BackdropSource | null): BackdropFlags {
  const map = useBackdropGeometry(source).geometry.data;
  const layers = useMemo(() => (map === undefined ? NO_LAYERS : mapLayers(map)), [map]);
  const opening = useMemo(() => (map === undefined ? 0 : openingFlags(map)), [map]);
  const [toggled, setToggled] = useState<{ map: MapGeometry; flags: number } | null>(null);
  const flags = toggled !== null && toggled.map === map ? toggled.flags : opening;

  const setLayer = useCallback(
    (index: number, on: boolean) => {
      if (map === undefined) return;
      setToggled((held) => {
        const from = held !== null && held.map === map ? held.flags : opening;
        const bit = 1 << index;
        return { map, flags: on ? from | bit : from & ~bit };
      });
    },
    [map, opening],
  );

  return { layers, flags, setLayer };
}

/**
 * The ambient occlusion `source`'s map states, and null until it lands or where it states none.
 *
 * The read is the one [`useMapBackdrop`] makes, so asking here fetches nothing.
 */
export function useBackdropAmbientOcclusion(
  source: BackdropSource | null,
): AmbientOcclusion | null {
  const model = useBackdropModel(source, useBackdropGeometry(source).geometry.data);
  const ssao = model.data?.ssao;
  return useMemo(() => (ssao == null ? null : ambientOcclusionOf(ssao)), [ssao]);
}
