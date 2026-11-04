import type {
  BinDocumentId,
  MapGeometryState,
  MapPath,
  NavGridSource,
  ShownMeshes,
} from "@/lib/tauri";
import type { MapVisibility } from "@/modules/viewport";

/** The inputs of one `map_conformance` check, which key its result. */
export interface ConformanceRequest {
  readonly document: BinDocumentId | null;
  readonly map: MapPath;
  readonly grid: NavGridSource;
  /** The indices of the overlays that are on, in list order. */
  readonly overlays: readonly number[];
  readonly shown: ShownMeshes;
  /** The largest accepted height difference, in world units. */
  readonly threshold: number;
  /** The id of the `.mapgeo` open for edits, and null for the file. */
  readonly geometry: number | null;
  /** The revision of the open `.mapgeo`. It keys the result, and the command does not take it. */
  readonly revision: number | null;
}

/** What the map scene holds of a `map_conformance` check. */
export interface ConformanceInputs {
  readonly document: BinDocumentId | null;
  readonly map: MapPath;
  readonly grid: NavGridSource;
  readonly overlays: readonly number[];
  /**
   * The visibility that selects the meshes of the ground. Its `hiddenMeshes` are not sent, so
   * a mesh that the reader hid still counts as ground.
   */
  readonly visibility: MapVisibility;
  readonly threshold: number;
  readonly geometry: MapGeometryState | null;
}

/** Returns the request of a `map_conformance` check of `inputs`. */
export function conformanceRequest(inputs: ConformanceInputs): ConformanceRequest {
  const { document, map, grid, overlays, visibility, threshold, geometry } = inputs;

  return {
    document,
    map,
    grid,
    overlays: [...overlays],
    shown: {
      flags: visibility.flags,
      controllers: Object.fromEntries(visibility.controllers),
    },
    threshold,
    geometry: geometry?.id ?? null,
    revision: geometry?.revision ?? null,
  };
}

/** Returns the arguments of `api.bin.mapConformance` for `request`, in order. */
export function conformanceArgs(
  request: ConformanceRequest,
): [
  BinDocumentId | null,
  MapPath,
  NavGridSource,
  readonly number[],
  ShownMeshes,
  number,
  number | null,
] {
  const { document, map, grid, overlays, shown, threshold, geometry } = request;
  return [document, map, grid, overlays, shown, threshold, geometry];
}
