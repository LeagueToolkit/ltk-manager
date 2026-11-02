import type { VfxValue } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import type { EmitterModel, ValueCurve } from "../../engine/model/model";
import { emissionEnd } from "../../engine/model/systemModel";
import { field, hashes, text } from "../../engine/parsing/readValue";
import {
  LINKED_SURFACE,
  MESH_SURFACE,
  SKELETON_SURFACE,
  SURFACE,
  SURFACE_FIELD,
} from "./emissionSource";

/** The inspector group whose section shows a check. */
export type CheckGroup = "emission" | "source";

/**
 * One finding about an emitter's emission.
 *
 * A `warning` is a state in which the game ignores a field or never emits. An `info` states an
 * engine rule or a limit of the preview that the rows do not show.
 */
export type EmissionCheck =
  | { readonly id: "noRate"; readonly group: "emission"; readonly tone: "warning" }
  | {
      readonly id: "endsBeforeStart";
      readonly group: "emission";
      readonly tone: "warning";
      readonly end: number;
      readonly start: number;
    }
  | { readonly id: "neverActive"; readonly group: "emission"; readonly tone: "warning" }
  | {
      readonly id: "activeWithoutPeriod";
      readonly group: "emission";
      readonly tone: "info";
      readonly active: number;
    }
  | { readonly id: "burstWithPeriod"; readonly group: "emission"; readonly tone: "info" }
  | {
      readonly id: "rateReplaced";
      readonly group: "emission";
      readonly tone: "info";
      readonly slope: number;
      readonly base: number;
      readonly most: number;
    }
  | { readonly id: "simpleSource"; readonly group: "source"; readonly tone: "warning" }
  | { readonly id: "surfaceEmpty"; readonly group: "source"; readonly tone: "info" }
  | { readonly id: "meshFilesMissing"; readonly group: "source"; readonly tone: "warning" }
  | { readonly id: "skeletonFileMissing"; readonly group: "source"; readonly tone: "warning" }
  | { readonly id: "submeshesUnmatched"; readonly group: "source"; readonly tone: "warning" }
  | { readonly id: "jointsUnmatched"; readonly group: "source"; readonly tone: "warning" }
  | { readonly id: "linkedMesh"; readonly group: "source"; readonly tone: "info" }
  | { readonly id: "generator"; readonly group: "source"; readonly tone: "info" }
  | { readonly id: "noUnit"; readonly group: "source"; readonly tone: "info" }
  | { readonly id: "stillNormals"; readonly group: "source"; readonly tone: "info" };

/** The inputs of the checks other than the emitter's own fields. */
export interface CheckContext {
  /** The emitter is in the simple emitter list. */
  readonly simple: boolean;
  /** The run's model of the emitter. Undefined outside a run. */
  readonly emitter: EmitterModel | undefined;
  /** The preview has a character host. */
  readonly bound: boolean;
  /** The submesh names of the surface's mesh. Null until the mesh has loaded. */
  readonly submeshes: readonly string[] | null;
  /** The names of the skeleton's joints that have a parent. Null until it has loaded. */
  readonly joints: readonly string[] | null;
}

const EMISSION_MESH = nameHash("emissionMeshName");

/**
 * The checks that `node` fails. `node` is one emitter of a resolved system.
 *
 * Each check applies a rule from the meta wiki's pages for `VfxEmitterDefinitionData` and the
 * emission surface classes. "The emission source" in docs/ux/BIN_EDITOR.md.
 */
export function emissionChecks(node: VfxValue | null, context: CheckContext): EmissionCheck[] {
  return [...timingChecks(context.emitter), ...sourceChecks(node, context)];
}

function timingChecks(emitter: EmitterModel | undefined): EmissionCheck[] {
  if (emitter === undefined) return [];

  const checks: EmissionCheck[] = [];
  if (emitter.culled === "noRate")
    checks.push({ id: "noRate", group: "emission", tone: "warning" });

  const end = emissionEnd(emitter);
  if (end !== null && end <= emitter.timeBeforeFirstEmission) {
    const start = emitter.timeBeforeFirstEmission;
    checks.push({ id: "endsBeforeStart", group: "emission", tone: "warning", end, start });
  }

  const { period } = emitter;
  const active = period?.active ?? null;
  if (active !== null && (active <= 0 || period?.length === 0)) {
    checks.push({ id: "neverActive", group: "emission", tone: "warning" });
  } else if (active !== null && period?.length === null) {
    checks.push({ id: "activeWithoutPeriod", group: "emission", tone: "info", active });
  }
  if (emitter.singleParticle && period !== null && period.length !== null) {
    checks.push({ id: "burstWithPeriod", group: "emission", tone: "info" });
  }

  if (emitter.rateByVelocity !== null) {
    const [slope, base] = emitter.rateByVelocity;
    const most = emitter.maximumRateByVelocity;
    checks.push({ id: "rateReplaced", group: "emission", tone: "info", slope, base, most });
  }

  return checks;
}

function sourceChecks(node: VfxValue | null, context: CheckContext): EmissionCheck[] {
  const definition = field(node, SURFACE_FIELD);
  const meshName = pathOf(field(node, EMISSION_MESH));
  const authored = definition?.type === "struct";
  if (context.simple) {
    const ignored = authored || meshName !== "";
    return ignored ? [{ id: "simpleSource", group: "source", tone: "warning" }] : [];
  }

  const checks: EmissionCheck[] = [];
  const surface = field(definition, SURFACE.surface);
  const generator = field(definition, SURFACE.generator);
  /* Before patch 15.22 the mesh fields were on the definition itself. */
  const flat = authored && surface === null && field(definition, SURFACE.mesh) !== null;
  const held = surface?.type === "struct" ? surface : flat ? definition : null;
  const heldClass = held?.type === "struct" && !flat ? held.classHash : null;

  if (authored && held === null && generator?.type !== "struct") {
    checks.push({ id: "surfaceEmpty", group: "source", tone: "info" });
  }

  const posed = flat || heldClass === MESH_SURFACE.hash || heldClass === SKELETON_SURFACE.hash;
  if (flat || heldClass === MESH_SURFACE.hash) {
    const named = pathOf(field(held, SURFACE.mesh)) !== "";
    const rigged = pathOf(field(held, SURFACE.skeleton)) !== "";
    if (!named || !rigged)
      checks.push({ id: "meshFilesMissing", group: "source", tone: "warning" });

    if (noneNamed(hashes(field(held, SURFACE.submeshes)), context.submeshes)) {
      checks.push({ id: "submeshesUnmatched", group: "source", tone: "warning" });
    }
  }
  if (heldClass === SKELETON_SURFACE.hash) {
    if (pathOf(field(held, SURFACE.skeleton)) === "") {
      checks.push({ id: "skeletonFileMissing", group: "source", tone: "warning" });
    }
    if (noneNamed(hashes(field(held, SURFACE.joints)), context.joints)) {
      checks.push({ id: "jointsUnmatched", group: "source", tone: "warning" });
    }
  }
  if (heldClass === LINKED_SURFACE.hash) {
    checks.push({ id: "linkedMesh", group: "source", tone: "info" });
  }
  if (generator?.type === "struct") checks.push({ id: "generator", group: "source", tone: "info" });
  if (posed && !context.bound) checks.push({ id: "noUnit", group: "source", tone: "info" });

  const { emitter } = context;
  const directed =
    emitter !== undefined &&
    (emitter.emissionMesh?.useNormal === true || emitter.emissionSurface?.useNormal === true);
  if (directed && still(emitter.birthVelocity) && still(emitter.birthAcceleration)) {
    checks.push({ id: "stillNormals", group: "source", tone: "info" });
  }

  return checks;
}

/** The path in a name field, which the reader returns as an asset or as a string. */
function pathOf(node: VfxValue | null): string {
  if (node?.type === "asset") return node.path;
  return text(node) ?? "";
}

/** True when `wanted` is not empty, `offered` has loaded, and no hash of `wanted` is in it. */
function noneNamed(wanted: readonly string[], offered: readonly string[] | null): boolean {
  if (wanted.length === 0 || offered === null) return false;

  const held = new Set(offered.map((name) => nameHash(name)));
  return !wanted.some((hash) => held.has(hash.toLowerCase()));
}

/** True when a birth vector is zero for every particle: a zero constant and no keys. */
function still(value: ValueCurve): boolean {
  return value.keys.length === 0 && value.constant.every((part) => part === 0);
}
