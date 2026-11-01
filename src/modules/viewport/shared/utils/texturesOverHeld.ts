/** Returns each key of `assets` with its texture in `textures`, else its texture in `held`. */
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

  return shown;
}
