/**
 * Returns each key of `assets` with its texture in `textures`, else its texture in `held`.
 *
 * Returns `held` itself if the result holds the same textures, so nothing built on it rebuilds.
 */
export function texturesOverHeld<T>(
  assets: ReadonlyMap<string, unknown>,
  held: ReadonlyMap<string, T>,
  textures: ReadonlyMap<string, T>,
): ReadonlyMap<string, T> {
  const shown = new Map<string, T>();

  for (const key of assets.keys()) {
    const texture = textures.get(key) ?? held.get(key);
    if (texture !== undefined) shown.set(key, texture);
  }

  return sameTextures(shown, held) ? held : shown;
}

/** Returns `true` if `a` and `b` hold the same texture object under each key. */
export function sameTextures<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): boolean {
  if (a.size !== b.size) return false;

  for (const [key, texture] of a) {
    if (b.get(key) !== texture) return false;
  }

  return true;
}
