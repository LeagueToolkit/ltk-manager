/** The element a translated block is declared with, `vec4 m[N]` or an integer vector. */
export type BlockElement = "vec4" | "ivec4" | "uvec4";

/**
 * `data` as the elements a stage declares its block with, over the same bytes.
 *
 * The shader turns an integer element back into a float with `uintBitsToFloat`, so an
 * integer view keeps each float's bits where a converted value would truncate it.
 */
export function elementView(
  data: Float32Array,
  element: BlockElement,
): Float32Array | Int32Array | Uint32Array {
  if (element === "uvec4") return new Uint32Array(data.buffer, data.byteOffset, data.length);
  if (element === "ivec4") return new Int32Array(data.buffer, data.byteOffset, data.length);
  return data;
}

/** The floats behind a block uniform's value, whichever `elementView` it uploads through. */
export function floatsOf(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (value instanceof Uint32Array || value instanceof Int32Array) {
    return new Float32Array(value.buffer, value.byteOffset, value.length);
  }
  return null;
}
