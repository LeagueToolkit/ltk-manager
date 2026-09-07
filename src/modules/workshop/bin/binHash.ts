/**
 * The game's FNV-1a over `text`, which is how a name becomes a hash in a bin.
 *
 * Lowercased first, over the UTF-8 bytes, so a table's spelling and an author's reach
 * the same hash. `Math.imul` is what keeps the multiply 32-bit.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of ENCODER.encode(text.toLowerCase())) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** `name` as the hash a row's path, a class and a field carry: `0x` and eight hex digits. */
export function nameHash(name: string): string {
  return `0x${fnv1a32(name).toString(16).padStart(8, "0")}`;
}

const ENCODER = new TextEncoder();
