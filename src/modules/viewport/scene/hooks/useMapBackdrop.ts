import { queryOptions, replaceEqualDeep, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { ClampToEdgeWrapping, NoColorSpace, type Texture } from "three";

import {
  api,
  type AssetRef,
  type BinDocumentId,
  type MapBounds,
  type MapController,
  type MapModel,
  type MapPath,
  type MaterialPreview,
  type MaterialProgram,
  type SandboxRef,
} from "@/lib/tauri";

import { BACKDROP_ROOT } from "../../assets/api/placements";
import { type EditedGeometry, viewportQueries } from "../../assets/api/queries";
import type { LightGrid } from "../../assets/parsing/lightGridBuffer";
import {
  type ControllerUse,
  controllerUses,
  type MapGeometry,
  type MapLayer,
  mapLayers,
  mapOrigin,
  openingFlags,
} from "../../assets/parsing/mapBuffer";
import {
  type ControllerOverrides,
  layerVisibility,
  type MapVisibility,
  mapVisibility,
  withControllerState,
} from "../../assets/utils/mapVisibility";
import { programTextureAssets } from "../../hexshade/programTextures";
import { useAssetTextures } from "../../shared/hooks/useAssetTextures";
import { type AmbientOcclusion, ambientOcclusionOf } from "../utils/ambientOcclusion";
import {
  type GrassTextures,
  grassTextures,
  grassTintAssets,
  grassTintOf,
} from "../utils/grassTint";
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
 * A block chain needs no decode, but each still costs an upload on the render thread, so a
 * whole set asked for at once lands in bursts no frame absorbs.
 */
const CONCURRENT = 8;

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
  /** The sandbox the map's files are located in, where it is not the whole of `project`. */
  readonly sandbox?: SandboxRef;
  /**
   * The map's `.mapgeo` where the scene has already found it, such as a copy a project
   * ships. Absent, the install's is looked up.
   */
  readonly geometry?: AssetRef;
  /** The `.mapgeo` open for edits that the backdrop draws in place of the file. */
  readonly edited?: EditedGeometry | null;
  /** The map's materials draw with the game's own shaders, translated. */
  readonly shaders?: boolean;
  /** The `MapSkin` whose grass tint the brush draws with. Absent or null selects `Default`. */
  readonly skin?: string | null;
}

/** The query arguments of an edited map that no source names, which never runs. */
const NOT_EDITED: EditedGeometry = { document: -1 };

/** Who answers a map's reads through a document, which is what two sources share them by. */
type ReadScope =
  | { readonly project: string | null }
  | { readonly document: BinDocumentId | null }
  | { readonly sandbox: SandboxRef };

/** The sandbox a source's files are located in: its project's, else the game's. ADR-0056. */
function sourceSandbox(source: BackdropSource | null): SandboxRef {
  if (source?.sandbox !== undefined) return source.sandbox;

  const project = source?.project ?? null;
  if (project === null) return { kind: "game" };

  return { kind: "project", project };
}

function readScope(source: BackdropSource | null): ReadScope {
  if (source?.sandbox !== undefined) return { sandbox: source.sandbox };
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
        const root = await api.readGameDir("game", MAP_GEOMETRY_DIR);
        if (!root.ok) throw root.error;
        const listings = await Promise.all(
          root.value.dirs.map(async (dir) => ({
            dir,
            read: await api.readGameDir("game", dir.path),
          })),
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
          return {
            materials: [],
            controllers: [],
            flags: [],
            sun: null,
            postEffects: null,
            ssao: null,
            lightGrid: null,
            grassTints: [],
            bounds: null,
          };
        const answer = await api.bin.readMap(document, map, [...paths]);
        if (!answer.ok) throw answer.error;
        return answer.value;
      },
      /* The same geometry under another scope, so a change of chosen layers keeps drawing. */
      placeholderData: (previous, query) =>
        query?.queryKey.at(-1) === paths ? previous : undefined,
      enabled: map !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),

  /* The materials bin is located as `model` locates it, so a project's copy answers
     before the install's and the programs read the same materials the slots do. */
  programs: (
    map: MapPath | null,
    document: BinDocumentId | null,
    scope: ReadScope,
    paths: readonly string[] | null,
  ) =>
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the scope keys the document
    queryOptions<(MaterialProgram | null)[]>({
      queryKey: [...BACKDROP_ROOT, "programs", map, scope, paths],
      queryFn: async () => {
        if (map === null || paths === null) return [];
        const answer = await api.bin.readMaterialPrograms({ kind: "map", map, document }, paths, {
          lowQuality: false,
        });
        if (!answer.ok) throw answer.error;
        return answer.value;
      },
      placeholderData: (previous, query) =>
        query?.queryKey.at(-1) === paths ? previous : undefined,
      enabled: map !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),

  /* Looked up in the source's sandbox, so a project's copy of a light map is used instead of
     the install's, as its geometry is. */
  lightmaps: (sandbox: SandboxRef | null, paths: readonly string[] | null) =>
    queryOptions<ReadonlyMap<string, AssetRef>>({
      queryKey: [...BACKDROP_ROOT, "lightmaps", sandbox, paths],
      queryFn: async () => {
        if (sandbox === null || paths === null || paths.length === 0) return new Map();
        const answer = await api.bin.locateFilesNear(sandbox, paths);
        if (!answer.ok) throw answer.error;
        return new Map(Object.entries(answer.value));
      },
      placeholderData: (previous, query) =>
        query?.queryKey.at(-1) === paths ? previous : undefined,
      enabled: sandbox !== null && paths !== null,
      staleTime: Infinity,
      retry: false,
    }),
};

/** A map backdrop's geometry and materials, and what it is doing while there is none. */
export interface Backdrop {
  readonly geometry: MapGeometry | null;
  /** The map's opening flags and the state of its controllers under them. */
  readonly visibility: MapVisibility;
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
  /** The shown skin's grass tints, and null where no skin states one. */
  readonly grassTint: GrassTextures | null;
  /** The rectangle that a map-wide texture covers, and null where the container states none. */
  readonly bounds: MapBounds | null;
  /** The bytes are on their way. One map is 73 to 93 MiB, so this is seconds. */
  readonly loading: boolean;
  /** Why there is nothing to draw, for the one line a disabled option carries. */
  readonly failure: string | null;
}

const NO_MATERIALS: readonly (MaterialPreview | null)[] = [];
const NO_PROGRAMS: readonly (MaterialProgram | null)[] = [];
const NO_LAYERS: readonly MapLayer[] = [];
const NO_CONTROLLERS: readonly MapController[] = [];
const NO_OVERRIDES: ControllerOverrides = new Map();
const NO_USES: ReadonlyMap<string, ControllerUse> = new Map();
const NO_TEXTURES: ReadonlyMap<string, Texture> = new Map();
const NO_ASSETS: ReadonlyMap<string, AssetRef> = new Map();

/** What has no program: a map with the shaders off. */
const EMPTY: Backdrop = {
  geometry: null,
  visibility: layerVisibility(0),
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
  grassTint: null,
  bounds: null,
  loading: false,
  failure: null,
};

/** Returns `source`, or the last source of `map` while a scene has none to offer yet. */
export function useHeldBackdropSource<S extends BackdropSource>(
  source: S | null,
  map: MapPath | null,
): S | null {
  const last = useRef<S | null>(null);
  if (source !== null) last.current = source;

  return source ?? (last.current?.map === map ? last.current : null);
}

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

  const tint = useMemo(
    () => grassTintOf(model.data?.grassTints ?? [], source?.skin ?? null),
    [model.data, source?.skin],
  );
  const tintAssets = useMemo(() => grassTintAssets(tint), [tint]);
  const tintTextures = useAssetTextures(tintAssets, {
    fullWidth: FULL_WIDTH,
    concurrency: CONCURRENT,
    holdWhileLoading: true,
    mips: true,
    colorSpace: NoColorSpace,
    wrap: ClampToEdgeWrapping,
  });
  const grassTint = useMemo(() => grassTextures(tint, tintTextures), [tint, tintTextures]);

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
    holdWhileLoading: true,
    mips: true,
  });
  const shaders = source?.shaders === true;
  const programsRead = useQuery(
    backdropQueries.programs(
      shaders ? (source?.map ?? null) : null,
      source?.document ?? null,
      readScope(source),
      geometry.data?.materials ?? null,
    ),
  );
  const programs = useSharedParts(programsRead.data) ?? NO_PROGRAMS;
  const lightmapAssets = useQuery(
    backdropQueries.lightmaps(
      shaders ? sourceSandbox(source) : null,
      geometry.data?.lightmaps ?? null,
    ),
  ).data;
  const lightmaps = useAssetTextures(lightmapAssets ?? NO_ASSETS, {
    fullWidth: FULL_WIDTH,
    concurrency: CONCURRENT,
    holdWhileLoading: true,
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
    holdWhileLoading: true,
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
  const controllers = model.data?.controllers ?? NO_CONTROLLERS;
  const visibility = useMemo(() => mapVisibility(controllers, opening), [controllers, opening]);

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
    visibility,
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
    grassTint,
    bounds: model.data?.bounds ?? null,
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
  const edited = source?.edited ?? null;
  const geometry = useQuery({
    ...viewportQueries.map(asset),
    enabled: edited === null,
  });
  const editedGeometry = useQuery({
    ...viewportQueries.editedMap(asset, edited ?? NOT_EDITED),
    enabled: edited !== null,
  });
  const read = edited === null ? geometry : editedGeometry;

  /* The last buffer of this map draws until a change of file or of edited document lands. */
  const map = source?.map ?? null;
  const drawn = useRef<{ readonly map: MapPath | null; readonly data: MapGeometry } | null>(null);
  if (read.data !== undefined) drawn.current = { map, data: read.data };
  const held =
    read.data === undefined && drawn.current?.map === map ? drawn.current?.data : undefined;

  return {
    given,
    located,
    asset,
    geometry: {
      data: read.data ?? held,
      error: read.error,
      isPending: read.isPending && held === undefined,
    },
  };
}

/** The materials, sun and screen effects of `source`'s map, asked for once `geometry` lands. */
function useBackdropModel(source: BackdropSource | null, geometry: MapGeometry | undefined) {
  const read = useQuery(
    backdropQueries.model(
      source?.map ?? null,
      source?.document ?? null,
      readScope(source),
      geometry?.materials ?? null,
    ),
  );

  return { data: useSharedParts(read.data) };
}

/**
 * Returns `value` with each part equal to its last value kept as the same object.
 *
 * A query shares equal parts with its own last answer only, and a change of chosen layers is
 * another query. A material that did not change keeps its identity, so nothing rebuilds it.
 */
function useSharedParts<T>(value: T): T {
  const last = useRef(value);
  const shared = useMemo(() => replaceEqualDeep(last.current, value), [value]);
  last.current = shared;

  return shared;
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
  /** Every layer that changes which meshes are drawn. Empty until the geometry is loaded. */
  readonly layers: readonly MapLayer[];
  /** The active set as a mask, and 0 until the geometry lands. */
  readonly flags: number;
  /** `flags` and the state of the map's controllers under them. A scene filters meshes and placeables by it. */
  readonly visibility: MapVisibility;
  readonly setLayer: (index: number, on: boolean) => void;
  /** The controllers that the map declares. Empty until the model is loaded. */
  readonly controllers: readonly MapController[];
  /** The name of each layer bit that the map's `Map` object names. Empty until the model is loaded. */
  readonly flagNames: ReadonlyMap<number, string>;
  /** The meshes that reference each controller, keyed by controller path hash. */
  readonly uses: ReadonlyMap<string, ControllerUse>;
  /** The controller states that the reader set, keyed by controller path hash. */
  readonly overrides: ControllerOverrides;
  /** Set the state of one controller. The states of its children are computed from it. */
  readonly setController: (hash: string, visible: boolean) => void;
  /** Whether the flags differ from the opening flags or a controller has an override. */
  readonly customized: boolean;
  /** Return to the opening flags and remove every controller override. */
  readonly reset: () => void;
}

/**
 * The visibility flags `source`'s backdrop draws, opening on the map's own and toggled after.
 *
 * A toggle is held against the geometry it was made on, so another map opens on its own
 * flags. An edited geometry holds it against the map path, so a toggle outlives each
 * edit. The geometry and the model are the ones [`useMapBackdrop`] reads, so asking here
 * fetches nothing.
 */
export function useBackdropFlags(source: BackdropSource | null): BackdropFlags {
  const map = useBackdropGeometry(source).geometry.data;
  const key: object | string | undefined = source?.edited == null ? map : source.map;
  const model = useBackdropModel(source, map).data;
  const controllers = model?.controllers ?? NO_CONTROLLERS;
  const modelFlags = model?.flags;
  const flagNames = useMemo(
    () => new Map((modelFlags ?? []).map((flag) => [flag.bit, flag.name])),
    [modelFlags],
  );
  const layers = useMemo(
    () => (map === undefined ? NO_LAYERS : mapLayers(map, controllers)),
    [map, controllers],
  );
  const uses = useMemo(() => (map === undefined ? NO_USES : controllerUses(map)), [map]);
  const opening = useMemo(() => (map === undefined ? 0 : openingFlags(map)), [map]);
  const [toggled, setToggled] = useState<Toggled | null>(null);
  const held = toggled !== null && toggled.key === key ? toggled : null;
  const flags = held?.flags ?? opening;
  const overrides = held?.overrides ?? NO_OVERRIDES;

  const setLayer = useCallback(
    (index: number, on: boolean) => {
      if (map === undefined) return;
      setToggled((last) => {
        const from = last !== null && last.key === key ? last : null;
        const before = from?.flags ?? opening;
        const bit = 1 << index;
        return {
          key,
          flags: on ? before | bit : before & ~bit,
          overrides: from?.overrides ?? NO_OVERRIDES,
        };
      });
    },
    [map, key, opening],
  );

  const setController = useCallback(
    (hash: string, visible: boolean) => {
      if (map === undefined) return;
      setToggled((last) => {
        const from = last !== null && last.key === key ? last : null;
        const before = from?.flags ?? opening;
        return {
          key,
          flags: before,
          overrides: withControllerState(
            controllers,
            before,
            from?.overrides ?? NO_OVERRIDES,
            hash,
            visible,
          ),
        };
      });
    },
    [map, key, opening, controllers],
  );

  const reset = useCallback(() => setToggled(null), []);

  const visibility = useMemo(
    () => mapVisibility(controllers, flags, overrides),
    [controllers, flags, overrides],
  );

  return {
    layers,
    flags,
    visibility,
    setLayer,
    controllers,
    flagNames,
    uses,
    overrides,
    setController,
    customized: flags !== opening || overrides.size > 0,
    reset,
  };
}

/** The flags and controller overrides that the reader set on one map. */
interface Toggled {
  /** The geometry the toggles were made on, or the map path of an edited geometry. */
  readonly key: object | string | undefined;
  readonly flags: number;
  readonly overrides: ControllerOverrides;
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
