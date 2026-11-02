import type { BinRow, FieldSchema, LeafValue, PropertyKind, ValueEdit } from "@/lib/tauri";

import { CURVE_DYNAMICS, curveLeaf } from "../../curves/utils/curveEdits";
import { nameHash } from "../../shared/utils/binHash";
import { classFamily } from "../../values/utils/valueRows";
import { defaultValue, parseDefault } from "../../vfx/inspector/utils/defaultValue";

/** What Reset to default does to a property row, per "Reset to default" in docs/ux/BIN_EDITOR.md. */
export type PropertyReset =
  | { readonly kind: "remove" }
  | { readonly kind: "leaf"; readonly leaf: LeafValue }
  | { readonly kind: "value"; readonly edits: ValueEdit[] }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused" };

/** The edit that empties an option, which then reads as the game's default. */
export const EMPTY_OPTION: readonly ValueEdit[] = [{ type: "removeItem", path: "[0]" }];

const CONSTANT_FIELD = nameHash("constantValue");
const CONSTANT = CONSTANT_FIELD.slice(2);
const DYNAMICS = CURVE_DYNAMICS.slice(2);

/** How many channels each value class's constant holds. */
const VALUE_WIDTH: ReadonlyMap<string, number> = new Map([
  [nameHash("ValueFloat"), 1],
  [nameHash("IntegratedValueFloat"), 1],
  [nameHash("ValueVector2"), 2],
  [nameHash("IntegratedValueVector2"), 2],
  [nameHash("ValueVector3"), 3],
  [nameHash("IntegratedValueVector3"), 3],
  [nameHash("ValueColorRgb"), 3],
  [nameHash("ValueColor"), 4],
]);

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The reset of `row`, whose field is `field` on its class, holding a curve where `curve`. */
export function propertyReset(
  row: BinRow,
  field: FieldSchema | undefined,
  declares: boolean,
  curve: boolean,
): PropertyReset {
  if (!declares) return { kind: "remove" };

  if (row.kind === "option") {
    const absent = row.value.type === "optional" && !row.value.present;
    return absent ? { kind: "unchanged" } : { kind: "value", edits: [...EMPTY_OPTION] };
  }

  const raw = parseDefault(field?.defaultValue);
  if (row.value.type === "struct" && VALUE_WIDTH.has(row.value.classHash)) {
    const edits = valueResetEdits(row.value.classHash, raw, curve);
    return edits === null ? { kind: "refused" } : { kind: "value", edits };
  }

  const kind = row.kind ?? field?.declared?.kind ?? null;
  const leaf = kind === null ? null : defaultLeaf(kind, raw);
  return leaf === null ? { kind: "refused" } : { kind: "leaf", leaf };
}

/** The leaf `kind` writes for the schema default `raw`, else the kind's own zero. */
export function defaultLeaf(kind: PropertyKind, raw: unknown): LeafValue | null {
  return schemaLeaf(kind, raw) ?? zeroLeaf(kind);
}

/**
 * The edits that set a value class's constant to its default and drop its curve.
 *
 * A colour's zero is opaque white and every other family's is 0, per channel.
 */
export function valueResetEdits(
  valueClass: string,
  raw: unknown,
  curve: boolean,
): ValueEdit[] | null {
  const family = classFamily(valueClass);
  const width = VALUE_WIDTH.get(valueClass);
  if (family === null || width === undefined) return null;

  const constant = isRecord(raw) ? raw.constantValue : undefined;
  const values =
    constantOf(constant, width) ?? Array<number>(width).fill(family === "color" ? 1 : 0);
  const leaf = curveLeaf(family, values);
  if (leaf === null) return null;

  const edits: ValueEdit[] = [
    { type: "ensureProperty", path: "", field: CONSTANT_FIELD },
    { type: "setLeaf", path: CONSTANT, value: leaf },
  ];
  if (curve) edits.push({ type: "replacePointer", path: DYNAMICS, class: null });
  return edits;
}

/** The path of the struct that the property at `path` sits in, which the property's own segment ends. */
export function parentPath(path: string): string {
  return path.length > 8 ? path.slice(0, -9) : "";
}

function schemaLeaf(kind: PropertyKind, raw: unknown): LeafValue | null {
  const value = defaultValue({ kind, key: null, value: null }, raw);
  switch (value?.type) {
    case "bool":
      return { type: "bool", value: value.value };
    case "float":
      return value.value === null ? null : { type: "float", value: value.value };
    case "integer":
      return { type: "integer", text: value.text };
    case "vector":
    case "matrix": {
      const cells = value.values.filter((cell): cell is number => cell !== null);
      return cells.length === value.values.length ? { type: value.type, values: cells } : null;
    }
    case "color":
      return { type: "color", r: value.r, g: value.g, b: value.b, a: value.a };
    case "string":
      return { type: "string", value: value.value };
    case "hash":
      return { type: "hash", text: value.hash };
    case "objectLink":
      return { type: "objectLink", text: value.hash };
    case "wadChunkLink":
      return { type: "wadChunkLink", text: value.hash };
    default:
      return null;
  }
}

function zeroLeaf(kind: PropertyKind): LeafValue | null {
  switch (kind) {
    case "bool":
    case "flag":
      return { type: "bool", value: false };
    case "f32":
      return { type: "float", value: 0 };
    case "i8":
    case "u8":
    case "i16":
    case "u16":
    case "i32":
    case "u32":
    case "i64":
    case "u64":
      return { type: "integer", text: "0" };
    case "vec2":
      return { type: "vector", values: [0, 0] };
    case "vec3":
      return { type: "vector", values: [0, 0, 0] };
    case "vec4":
      return { type: "vector", values: [0, 0, 0, 0] };
    case "mtx44":
      return { type: "matrix", values: [...IDENTITY] };
    case "rgba":
      return { type: "color", r: 255, g: 255, b: 255, a: 255 };
    case "string":
      return { type: "string", value: "" };
    case "hash":
      return { type: "hash", text: "0x00000000" };
    case "link":
      return { type: "objectLink", text: "0x00000000" };
    case "file":
      return { type: "wadChunkLink", text: "0000000000000000" };
    default:
      return null;
  }
}

/** The channels of a schema constant, or null where it is not `width` finite numbers. */
function constantOf(constant: unknown, width: number): number[] | null {
  const values = typeof constant === "number" ? [constant] : constant;
  if (!Array.isArray(values) || values.length !== width) return null;
  return values.every((cell) => typeof cell === "number" && Number.isFinite(cell))
    ? (values as number[])
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
