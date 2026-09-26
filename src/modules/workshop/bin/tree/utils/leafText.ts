import type { BinValue, EditRejection, LeafValue, PropertyKind } from "@/lib/tauri";

/**
 * What a reader typed, as the value a leaf edit sends or the refusal it would meet.
 *
 * The frontend turns down what JSON cannot carry and what a byte cannot hold, so the
 * common mistake never round-trips. The backend decides the rest. "Validation" in
 * docs/ux/BIN_EDITOR.md.
 */
export type TypedLeaf =
  | { readonly ok: true; readonly leaf: LeafValue }
  | { readonly ok: false; readonly rejection: EditRejection };

function typed(leaf: LeafValue): TypedLeaf {
  return { ok: true, leaf };
}

function refused(rejection: EditRejection): TypedLeaf {
  return { ok: false, rejection };
}

export function boolLeaf(value: boolean): TypedLeaf {
  return typed({ type: "bool", value });
}

/** The least and the most each integer kind holds. */
const INTEGER_RANGES: Partial<Record<PropertyKind, readonly [bigint, bigint]>> = {
  i8: [-(2n ** 7n), 2n ** 7n - 1n],
  u8: [0n, 2n ** 8n - 1n],
  i16: [-(2n ** 15n), 2n ** 15n - 1n],
  u16: [0n, 2n ** 16n - 1n],
  i32: [-(2n ** 31n), 2n ** 31n - 1n],
  u32: [0n, 2n ** 32n - 1n],
  i64: [-(2n ** 63n), 2n ** 63n - 1n],
  u64: [0n, 2n ** 64n - 1n],
};

/** The digits as typed, refused where `kind` cannot hold them. An unknown kind is the backend's to check. */
export function integerLeaf(text: string, kind: PropertyKind | null = null): TypedLeaf {
  const trimmed = text.trim();
  const range = kind === null ? undefined : INTEGER_RANGES[kind];
  if (kind === null || range === undefined) return typed({ type: "integer", text: trimmed });

  const [least, most] = range;
  const number = /^[-+]?\d+$/.test(trimmed) ? BigInt(trimmed) : null;
  if (number === null || number < least || number > most) {
    return refused({ reason: "outOfRange", kind });
  }
  return typed({ type: "integer", text: trimmed });
}

/** The finite number `text` writes, or null. */
function finite(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function floatLeaf(text: string): TypedLeaf {
  const value = finite(text);
  if (value === null) return refused({ reason: "notFinite" });
  return typed({ type: "float", value });
}

/** `values` with the component `at` replaced by `text`, or null where one is not finite. */
function replaced(values: readonly (number | null)[], at: number, text: string): number[] | null {
  const component = finite(text);
  if (component === null) return null;
  const next: number[] = [];
  for (const [index, held] of values.entries()) {
    const cell = index === at ? component : held;
    if (cell === null) return null;
    next.push(cell);
  }
  return next;
}

/** The vector `values` with the component `at` replaced by `text`. */
export function vectorLeaf(
  values: readonly (number | null)[],
  at: number,
  text: string,
): TypedLeaf {
  const next = replaced(values, at, text);
  if (next === null) return refused({ reason: "notFinite" });
  return typed({ type: "vector", values: next });
}

/** The matrix `values`, row-major, with the cell `at` replaced by `text`. */
export function matrixLeaf(
  values: readonly (number | null)[],
  at: number,
  text: string,
): TypedLeaf {
  const next = replaced(values, at, text);
  if (next === null) return refused({ reason: "notFinite" });
  return typed({ type: "matrix", values: next });
}

/** A string as typed, spaces and all. */
export function stringLeaf(text: string): TypedLeaf {
  return typed({ type: "string", value: text });
}

/** The zero hash a cleared field writes, which the game reads as no link and no file. */
const NULL_HASH = {
  hash: "0x00000000",
  objectLink: "0x00000000",
  wadChunkLink: "0000000000000000",
};

/** A name or its hex, for a `hash`, a `link` or a `file`. A cleared field writes the zero hash. */
export function hashedLeaf(type: "hash" | "objectLink" | "wadChunkLink", text: string): TypedLeaf {
  const trimmed = text.trim();
  return typed({ type, text: trimmed === "" ? NULL_HASH[type] : trimmed });
}

/** The colour with the channel `at`, in `rgba` order, replaced by `text`. */
export function colorLeaf(
  color: Extract<BinValue, { type: "color" }>,
  at: number,
  text: string,
): TypedLeaf {
  const trimmed = text.trim();
  const channel = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!(channel >= 0 && channel <= 255)) return refused({ reason: "outOfRange", kind: "u8" });
  const channels = [color.r, color.g, color.b, color.a].map((held, index) =>
    index === at ? channel : held,
  );
  const [r = 0, g = 0, b = 0, a = 0] = channels;
  return typed({ type: "color", r, g, b, a });
}
