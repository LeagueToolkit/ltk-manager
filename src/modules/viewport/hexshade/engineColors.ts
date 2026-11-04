import { BufferAttribute } from "three";

/** Returns a block of RGBA bytes as the BGRA attribute a translated stage reads `a_COLOR` in. */
export function engineColors(colors: ArrayLike<number>): BufferAttribute {
  const swapped = Uint8Array.from(colors);
  for (let at = 0; at + 3 < swapped.length; at += 4) {
    swapped[at] = colors[at + 2];
    swapped[at + 2] = colors[at];
  }

  return new BufferAttribute(swapped, 4, true);
}
