import type { AssetRef, NamedAsset, VfxValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import type { CurveKey, ProbabilityTable } from "../valueRows";
import {
  BLEND_MODE,
  type BlendMode,
  LINGER_TYPE,
  type LingerType,
  QUAD_TYPE,
  type QuadType,
  STENCIL_MODE,
  type StencilMode,
  UV_MODE,
  type UvMode,
} from "./enums";
import type { ValueCurve } from "./model";
import type { Point } from "./rig";

/** The alpha-test byte's own range, which `alphaRef` is divided by. */
export const ALPHA_REF_SCALE = 255;

/** The alpha test cutoff the schema defaults to, over [`ALPHA_REF_SCALE`]. */
export const DEFAULT_ALPHA_REF = 5;

/** The primitive class of each kind of `ParticleSystem::QUAD_TYPE`. */
const QUAD_OF_CLASS: ReadonlyMap<string, QuadType> = new Map([
  [nameHash("VfxPrimitiveCameraQuad"), QUAD_TYPE.cameraQuad],
  [nameHash("VfxPrimitiveArbitraryQuad"), QUAD_TYPE.arbitraryQuad],
  [nameHash("VfxPrimitiveRay"), QUAD_TYPE.ray],
  [nameHash("VfxPrimitiveMesh"), QUAD_TYPE.mesh],
  [nameHash("VfxPrimitiveCameraTrail"), QUAD_TYPE.cameraTrail],
  [nameHash("VfxPrimitiveArbitraryTrail"), QUAD_TYPE.arbitraryTrail],
  [nameHash("VfxPrimitiveBeam"), QUAD_TYPE.beam],
  [nameHash("VfxPrimitivePlanarProjection"), QUAD_TYPE.planarProjection],
  [nameHash("VfxPrimitiveCameraUnitQuad"), QUAD_TYPE.cameraUnitQuad],
  [nameHash("VfxPrimitiveCameraSegmentBeam"), QUAD_TYPE.cameraSegmentBeam],
  [nameHash("VfxPrimitiveAttachedMesh"), QUAD_TYPE.attachedMesh],
]);

/** What every value class of the family holds: its constant, and the curve that animates it. */
const VALUE = {
  constant: nameHash("constantValue"),
  dynamics: nameHash("dynamics"),
  times: nameHash("times"),
  values: nameHash("values"),
  tables: nameHash("probabilityTables"),
} as const;

/** `VfxProbabilityTableData`'s own fields, one table per channel of its curve. */
const TABLE = {
  keyTimes: nameHash("keyTimes"),
  keyValues: nameHash("keyValues"),
  single: nameHash("singleValue"),
} as const;

/** What a table with no keys is worth, which the schema writes as the field's default. */
const SINGLE_DEFAULT = 1;

/** The tables slot of a curve carrying none, shared so `constant` allocates one array once. */
const NO_TABLES: readonly ProbabilityTable[] = Object.freeze([]);

/* Every default below is the one the meta schema declares for the field, so an emitter
   that writes no row for it evaluates the way the engine's own reader would. */
export const DEFAULT = {
  rate: constant([0]),
  particleLifetime: constant([3]),
  zero: constant([0]),
  zero3: constant([0, 0, 0]),
  one3: constant([1, 1, 1]),
  white: constant([1, 1, 1, 1]),
  zero2: constant([0, 0]),
  one2: constant([1, 1]),
  one: constant([1]),
  /** `palleteSrcMixColor`'s own default, the weights of a luma. */
  luma: constant([0.299, 0.587, 0.114, 0]),
  /** `erosionMapChannelMixer`'s own default, which reads the alpha alone. */
  alpha: constant([0, 0, 0, 1]),
} as const;

/** The value under `hash`, and null where the object writes no field for it. */
export function field(node: VfxValue | null, hash: string): VfxValue | null {
  if (node === null || node.type !== "struct") return null;
  return node.fields.find((each) => each.hash === hash)?.value ?? null;
}

/**
 * A value class as the sampler reads one.
 *
 * The two lists of a curve are written in step, so a key is one index of each and a list
 * longer than the other contributes nothing past where they agree. `valueRows.ts` reads
 * the same pair one projected level at a time.
 */
export function curve(node: VfxValue | null, fallback: ValueCurve): ValueCurve {
  if (node?.type !== "struct") return fallback;

  const held = components(field(node, VALUE.constant));
  const dynamics = field(node, VALUE.dynamics);
  return {
    constant: held ?? fallback.constant,
    keys: dynamics === null ? [] : curveKeys(dynamics),
    tables: dynamics === null ? [] : curveTables(dynamics),
  };
}

/**
 * The curve's probability tables, one slot per channel and a null slot no table.
 *
 * The slots are nullable, so a channel is the slot's own index and a null one contributes
 * nothing rather than shifting the rest, as `valueRows.ts` reads them for the editor.
 */
function curveTables(dynamics: VfxValue): ProbabilityTable[] {
  const list = field(dynamics, VALUE.tables);
  if (list?.type !== "container") return [];

  const out: ProbabilityTable[] = [];
  list.items.forEach((slot, channel) => {
    if (slot.type !== "struct") return;
    const times = field(slot, TABLE.keyTimes);
    const values = field(slot, TABLE.keyValues);
    const keys: CurveKey[] = [];
    if (times?.type === "container" && values?.type === "container") {
      /* Lists of two lengths are worth nothing rather than the shorter, and a keyed
         table is what reaches that. */
      if (times.items.length > 0 && times.items.length !== values.items.length) {
        out.push({ channel, single: 0, keys });
        return;
      }
      for (let at = 0; at < times.items.length; at += 1) {
        const time = number(times.items[at]);
        const held = number(values.items[at]);
        if (time === null || held === null) continue;
        keys.push({ time, values: [held] });
      }
    }
    out.push({ channel, single: number(field(slot, TABLE.single)) ?? SINGLE_DEFAULT, keys });
  });
  return out;
}

function curveKeys(dynamics: VfxValue): readonly CurveKey[] {
  const times = field(dynamics, VALUE.times);
  const values = field(dynamics, VALUE.values);
  if (times?.type !== "container" || values?.type !== "container") return [];

  const keys: CurveKey[] = [];
  for (let at = 0; at < Math.min(times.items.length, values.items.length); at += 1) {
    const time = number(times.items[at]);
    const held = components(values.items[at]);
    if (time === null || held === null) continue;
    keys.push({ time, values: held });
  }
  return keys;
}

/**
 * A leaf as its channels: one for a number, and its own components for a vector.
 *
 * A component is null where the float is one JSON does not carry, and a value missing a
 * channel is one nothing can sample, so the whole leaf reads as absent.
 */
export function components(node: VfxValue | null | undefined): number[] | null {
  if (node?.type === "number") return node.value === null ? null : [node.value];
  if (node?.type !== "vector") return null;
  const held = node.values.filter((component) => component !== null);
  return held.length === node.values.length ? held : null;
}

export function number(node: VfxValue | null | undefined): number | null {
  return node?.type === "number" ? node.value : null;
}

export function text(node: VfxValue | null): string | null {
  return node?.type === "string" ? node.value : null;
}

export function flag(node: VfxValue | null): boolean {
  return node?.type === "bool" && node.value;
}

/** A flag as written, and `fallback` for a field the object does not write. */
export function flagOr(node: VfxValue | null, fallback: boolean): boolean {
  return node?.type === "bool" ? node.value : fallback;
}

/** A `Mtx44` as its sixteen cells, and null for a field the object does not write whole. */
export function matrix(node: VfxValue | null): number[] | null {
  if (node?.type !== "matrix" || node.values.length !== 16) return null;
  const out: number[] = [];
  for (const cell of node.values) {
    if (cell === null) return null;
    out.push(cell);
  }
  return out;
}

/**
 * The texture a field names, and null for one the emitter does not name.
 *
 * An `asset` node's `asset` is null for a path the install does not ship, which the
 * caller reads apart from a field naming none at all.
 */
export function namedAsset(node: VfxValue | null): NamedAsset | null {
  if (node?.type === "asset")
    return node.path === "" ? null : { path: node.path, asset: node.asset };
  const held = text(node);
  return held === null || held === "" ? null : { path: held, asset: null };
}

/** A name field the backend placed. */
export interface Placed {
  readonly asset: AssetRef;
  readonly path: string;
}

/** A name field the backend placed, and null for one it could not. */
export function located(node: VfxValue | null): Placed | null {
  if (node?.type !== "asset" || node.asset === null) return null;
  return { asset: node.asset, path: node.path };
}

/** The path a name field carries, placed or not, and null for one left empty. */
export function named(node: VfxValue | null): string | null {
  if (node?.type !== "asset" || node.path === "") return null;
  return node.path;
}

/** The hashes a `List<Hash>` holds, each `0x` and eight hex digits. */
export function hashes(node: VfxValue | null): string[] {
  if (node?.type !== "container") return [];
  return node.items.flatMap((item) => (item.type === "hash" ? [item.hash] : []));
}

/** The strings a `List<String>` holds. */
export function texts(node: VfxValue | null): string[] {
  if (node?.type !== "container") return [];
  return node.items.flatMap((item) => (item.type === "string" ? [item.value] : []));
}

/** A `Vec2` as the pair it holds, and zeroes for a field the object does not write. */
export function pair(node: VfxValue | null): [number, number] {
  const held = components(node);
  return [held?.[0] ?? 0, held?.[1] ?? 0];
}

/** A `Vec2` as the pair it holds, and `fallback` for a field the object does not write. */
export function pairOr(
  node: VfxValue | null,
  fallback: readonly [number, number],
): [number, number] {
  const held = components(node);
  if (held === null) return [fallback[0], fallback[1]];
  return [held[0] ?? fallback[0], held[1] ?? fallback[1]];
}

/** A `Vec3` as the point it holds, and the origin for a field the object does not write. */
export function triple(node: VfxValue | null): Point {
  return tripleOr(node, [0, 0, 0]);
}

/** A `Vec3` as the point it holds, and `fallback` for a field the object does not write. */
export function tripleOr(node: VfxValue | null, fallback: Point): Point {
  const held = components(node);
  return [held?.[0] ?? fallback[0], held?.[1] ?? fallback[1], held?.[2] ?? fallback[2]];
}

/** A `Vec4` as its four channels, and `fallback` for a field the object does not write. */
export function channelsOr(
  node: VfxValue | null,
  fallback: readonly [number, number, number, number],
): [number, number, number, number] {
  const held = components(node) ?? [];
  return [
    held[0] ?? fallback[0],
    held[1] ?? fallback[1],
    held[2] ?? fallback[2],
    held[3] ?? fallback[3],
  ];
}

/** A `List<Embed<ValueFloat>>` as its curves, each at zero where the item is no value class. */
export function curves(node: VfxValue | null): ValueCurve[] {
  if (node?.type !== "container") return [];
  return node.items.map((item) => curve(item, DEFAULT.zero));
}

export function constant(values: readonly number[]): ValueCurve {
  return { constant: values, keys: [], tables: NO_TABLES };
}

/** The member of `table` the byte names, and `fallback` for one outside it. */
export function enumByte<T extends number>(
  node: VfxValue | null,
  table: Readonly<Record<string, T>>,
  fallback: T,
): T {
  const held = number(node);
  if (held === null || !Number.isInteger(held)) return fallback;
  return Object.values(table).includes(held as T) ? (held as T) : fallback;
}

/** The UV mode the byte names, and `default` for one outside the enum. */
export function uvMode(node: VfxValue | null): UvMode {
  return enumByte(node, UV_MODE, UV_MODE.default);
}

/** A byte outside the enum reads as `kDisabled`, which is the mode the schema defaults to. */
export function stencilMode(node: VfxValue | null): StencilMode {
  return enumByte(node, STENCIL_MODE, STENCIL_MODE.disabled);
}

/** A byte outside the enum reads as `ADD`, which is the mode the schema defaults to. */
export function blendMode(node: VfxValue | null): BlendMode {
  return enumByte(node, BLEND_MODE, BLEND_MODE.add);
}

/** The linger type the byte names, and the default for one outside the enum. */
export function lingerType(node: VfxValue | null): LingerType {
  return enumByte(node, LINGER_TYPE, LINGER_TYPE.maxLifetimeAfterEmitterDies);
}

/**
 * The primitive's kind, and a camera quad for an emitter that names no primitive.
 *
 * Null for a class the map has no kind for: `VfxPrimitiveLaser` and `VfxPrimitiveRibbon`,
 * which section 3.1 of docs/plans/vfx-particle-renderer.md attests at 14 and 15,
 * `VfxPrimitiveCameraSegmentSeriesBeam`, and `VfxPrimitiveNonRenderable`, which the meta
 * tree carries without a kind at all. Reading any of them as a camera quad would draw a
 * primitive as something it is not and leave `isUndrawn` quiet about it.
 */
export function quadType(node: VfxValue | null): QuadType | null {
  if (node?.type !== "struct") return QUAD_TYPE.cameraQuad;
  return QUAD_OF_CLASS.get(node.classHash) ?? null;
}
